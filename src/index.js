require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const express = require("express");

// --- Discord Bot Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  rest: { timeout: 30_000 },
});

// Prevent crashes on network errors — discord.js auto-reconnects
client.on("error", (err) => console.error("Client error:", err.message));
client.on("shardError", (err) => console.error("WebSocket error:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err.message));

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

// Load event handlers
const campaignEntry = require("./events/campaignEntry");

// Handle interactions
client.on("interactionCreate", async (interaction) => {
  // Button clicks
  if (interaction.isButton()) {
    try {
      await campaignEntry.handleButton(interaction);
    } catch (error) {
      console.error("Button handler error:", error);
    }
    return;
  }

  // Modal submissions
  if (interaction.isModalSubmit()) {
    try {
      await campaignEntry.handleModalSubmit(interaction);
    } catch (error) {
      console.error("Modal handler error:", error);
    }
    return;
  }

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing ${interaction.commandName}:`, error);
      const reply = {
        content: "Something went wrong running that command.",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  }
});

client.once("ready", () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

// --- Express Server (for Vouch + Lumina webhooks) ---
const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.send("OK"));

// Simple "verification done" landing page clippers get redirected to
app.get("/verify/done", (req, res) => {
  res.send(`<!doctype html><html><head><title>Verified</title>
    <style>body{font-family:system-ui;background:#1a1a2e;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;padding:40px;background:#16213e;border-radius:12px;max-width:400px}</style>
    </head><body><div><h1>\u2705 Verification Complete</h1>
    <p>You can close this tab and return to Discord \u2014 your submission status will update shortly.</p>
    </div></body></html>`);
});

// Vouch webhook: POST /api/webhook/vouch
// Vouch sends `Authorization: PSK <webhook-secret>` header.
const { unpackMetadata } = require("./vouch");
const { patchVerification } = require("./api");

app.post("/api/webhook/vouch", async (req, res) => {
  const auth = req.headers.authorization;
  const expected = `PSK ${process.env.VOUCH_WEBHOOK_SECRET}`;
  if (auth !== expected) {
    console.warn("Rejected Vouch webhook: bad auth header");
    return res.status(401).send("Unauthorized");
  }

  const { requestId, metadata, outputs } = req.body;
  console.log("Vouch webhook received, requestId:", requestId);

  const { submissionId, discordUserId } = unpackMetadata(metadata || "");
  if (!submissionId) {
    console.warn("Vouch webhook missing submissionId in metadata");
    return res.status(400).send("Bad metadata");
  }

  // Push verification result back to Lumina
  try {
    await patchVerification(submissionId, {
      verification_status: "verified",
      verification_request_id: requestId,
      outputs,
    });
    console.log(`Patched Lumina submission ${submissionId} as verified.`);
  } catch (err) {
    console.error("Failed to PATCH Lumina:", err);
  }

  // DM the clipper confirming verification
  if (discordUserId) {
    try {
      const user = await client.users.fetch(discordUserId);
      const { EmbedBuilder } = require("discord.js");
      const embed = new EmbedBuilder()
        .setTitle("\u2705 Verification Complete")
        .setDescription(
          `Your submission \`${submissionId}\` is now **verified**.\n` +
            `Your stats and demographics have been recorded.`
        )
        .setColor(0x00c853)
        .setTimestamp();
      await user.send({ embeds: [embed] });
    } catch (err) {
      console.warn("Couldn't DM clipper after verification:", err.message);
    }
  }

  res.sendStatus(200);
});

// Lumina webhook: POST /api/webhook/lumina
// Lumina sends X-Webhook-Signature: t=<unix>,v1=<hex>
// where hex = HMAC_SHA256(secret, "<t>.<rawBody>")
const crypto = require("crypto");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");

app.post(
  "/api/webhook/lumina",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const rawBody = req.body.toString("utf8");
    const secret = process.env.LUMINA_WEBHOOK_SECRET;

    if (!secret) {
      console.error("LUMINA_WEBHOOK_SECRET not configured");
      return res.status(500).send("Webhook secret not configured");
    }

    // Parse signature header: "t=<unix>,v1=<hex>"
    const sigHeader = req.headers["x-webhook-signature"] || "";
    const parts = Object.fromEntries(
      sigHeader.split(",").map((p) => p.split("=").map((s) => s.trim()))
    );
    const { t, v1 } = parts;

    if (!t || !v1) {
      console.warn("Rejected Lumina webhook: missing signature parts");
      return res.status(401).send("Missing signature");
    }

    // Replay protection: reject if timestamp differs from now by more than 5 min
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - Number(t)) > 300) {
      console.warn(`Rejected Lumina webhook: stale timestamp (diff ${nowSec - Number(t)}s)`);
      return res.status(401).send("Stale timestamp");
    }

    // Compute expected HMAC
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${t}.${rawBody}`)
      .digest("hex");

    // Timing-safe compare
    const valid =
      expected.length === v1.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));

    if (!valid) {
      console.warn("Rejected Lumina webhook: HMAC mismatch");
      return res.status(401).send("Bad signature");
    }

    // Signature is valid — parse body
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).send("Bad JSON");
    }

    console.log("Lumina webhook received:", payload.event || payload.type);

    // Dispatch by event type
    const eventName = payload.event || payload.type;
    const data = payload.data || payload.campaign || payload;

    if (eventName === "campaign.created") {
      await postCampaignAnnouncement(data);
    } else {
      console.log(`Unhandled Lumina event: ${eventName}`);
    }

    res.sendStatus(200);
  }
);

async function postCampaignAnnouncement(campaign) {
  const channelId = process.env.ANNOUNCEMENTS_CHANNEL_ID;
  if (!channelId) {
    console.warn("ANNOUNCEMENTS_CHANNEL_ID not set, skipping announcement");
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.warn(`Channel ${channelId} not found or not text-based`);
      return;
    }

    const platforms = Array.isArray(campaign.accepted_platforms)
      ? campaign.accepted_platforms.join(" \u2022 ")
      : campaign.accepted_platforms || "all platforms";

    const embed = new EmbedBuilder()
      .setTitle(`\uD83C\uDFAC  New Campaign: ${campaign.name || "Untitled"}`)
      .setDescription(
        (campaign.description || "A new campaign just went live!") +
          `\n\n\uD83D\uDCB0 **CPM:** $${(campaign.cpm_rate || 0).toFixed(2)} per 1k views` +
          `\n\uD83D\uDCB5 **Max Payout:** $${(campaign.max_payout || 0).toFixed(2)}` +
          `\n\uD83C\uDF10 **Platforms:** ${platforms}`
      )
      .setColor(0x7c3aed)
      .setTimestamp();

    if (campaign.thumbnail_url) embed.setImage(campaign.thumbnail_url);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`enter_campaign_${campaign.id}`)
        .setLabel("\uD83D\uDE80 Enter Campaign")
        .setStyle(ButtonStyle.Success)
    );

    if (campaign.requirements_url) {
      row.addComponents(
        new ButtonBuilder()
          .setLabel("\uD83D\uDCCB Requirements")
          .setStyle(ButtonStyle.Link)
          .setURL(campaign.requirements_url)
      );
    }

    await channel.send({
      content: "@everyone A new campaign is live!",
      embeds: [embed],
      components: [row],
    });
    console.log(`Posted campaign announcement: ${campaign.name}`);
  } catch (err) {
    console.error("Failed to post campaign announcement:", err);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

// --- Login ---
client.login(process.env.DISCORD_TOKEN);
