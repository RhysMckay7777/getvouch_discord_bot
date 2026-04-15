const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { submitEntry } = require("../api");
const { DATASOURCES } = require("../vouch");

// Handle "Single Submit" / "Bulk Submit" button clicks → show appropriate modal
async function handleButton(interaction) {
  if (interaction.customId.startsWith("enter_campaign_")) {
    return showSingleModal(interaction);
  }
  if (interaction.customId.startsWith("bulk_entry_")) {
    return showBulkModal(interaction);
  }
  return false;
}

async function showSingleModal(interaction) {
  const campaignId = interaction.customId.replace("enter_campaign_", "");

  const modal = new ModalBuilder()
    .setCustomId(`submit_entry_${campaignId}`)
    .setTitle("Single Submit");

  const emailInput = new TextInputBuilder()
    .setCustomId("clipper_email")
    .setLabel("Your email")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("you@example.com")
    .setRequired(true);

  const linkInput = new TextInputBuilder()
    .setCustomId("post_url")
    .setLabel("Link to your content")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("https://www.instagram.com/reel/...")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(emailInput),
    new ActionRowBuilder().addComponents(linkInput)
  );

  await interaction.showModal(modal);
  return true;
}

async function showBulkModal(interaction) {
  const campaignId = interaction.customId.replace("bulk_entry_", "");

  const modal = new ModalBuilder()
    .setCustomId(`bulk_submit_${campaignId}`)
    .setTitle("Bulk Submit");

  const emailInput = new TextInputBuilder()
    .setCustomId("clipper_email")
    .setLabel("Your email")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("you@example.com")
    .setRequired(true);

  const linksInput = new TextInputBuilder()
    .setCustomId("post_urls")
    .setLabel("Links (one per line)")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("https://instagram.com/reel/abc\nhttps://tiktok.com/@user/video/123\nhttps://youtu.be/xyz")
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(emailInput),
    new ActionRowBuilder().addComponents(linksInput)
  );

  await interaction.showModal(modal);
  return true;
}

// Handle modal submission → call API
async function handleModalSubmit(interaction) {
  if (interaction.customId.startsWith("submit_entry_")) {
    return handleSingleSubmit(interaction);
  }
  if (interaction.customId.startsWith("bulk_submit_")) {
    return handleBulkSubmit(interaction);
  }
  return false;
}

async function handleSingleSubmit(interaction) {
  const campaignId = interaction.customId.replace("submit_entry_", "");
  const clipperEmail = interaction.fields.getTextInputValue("clipper_email");
  const postUrl = interaction.fields.getTextInputValue("post_url");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const result = await submitEntry({
      campaign_id: campaignId,
      clipper_email: clipperEmail,
      post_url: postUrl,
      discord_user_id: interaction.user.id,
    });

    if (result.status === "ok") {
      const platform = result.platform || "unknown";
      const platformIcon = {
        instagram: "\uD83D\uDCF7",
        tiktok: "\uD83C\uDFB5",
        youtube: "\u25B6\uFE0F",
        twitter: "\uD83D\uDC26",
      }[platform] || "\uD83C\uDF10";

      const embed = new EmbedBuilder()
        .setTitle(`\u2705  Submission Received`)
        .setDescription(
          `${platformIcon} **Platform:** ${platform}\n` +
            `\uD83D\uDCCB **Status:** \`awaiting_stats\`\n` +
            `\uD83D\uDD10 **Verification:** \`pending\`\n\n` +
            `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
            `Click **Verify Stats** below to prove ownership of your \`${platform}\` account ` +
            `and unlock your verified status.`
        )
        .setColor(0x00c853)
        .setFooter({ text: `ID: ${result.submission_id}` })
        .setTimestamp();

      const components = [];
      if (DATASOURCES[platform]) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_stats_${result.submission_id}_${platform}`)
            .setLabel("\uD83D\uDD10 Verify Stats")
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row);
      }

      await interaction.editReply({ embeds: [embed], components });
    } else {
      await interaction.editReply(`Submission failed: ${result.detail || result.message || "Unknown error"}`);
    }
  } catch (err) {
    console.error("Submit entry error:", err);
    await interaction.editReply("Something went wrong submitting your entry. Try again later.");
  }

  return true;
}

async function handleBulkSubmit(interaction) {
  const campaignId = interaction.customId.replace("bulk_submit_", "");
  const clipperEmail = interaction.fields.getTextInputValue("clipper_email");
  const rawUrls = interaction.fields.getTextInputValue("post_urls");

  const urls = rawUrls
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (urls.length === 0) {
    return interaction.editReply("No URLs provided. Please paste at least one link.");
  }

  // TODO: replace with bulk endpoint when Lumina ships POST /submissions/bulk
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await submitEntry({
          campaign_id: campaignId,
          clipper_email: clipperEmail,
          post_url: url,
          discord_user_id: interaction.user.id,
        });
        return { url, ...res };
      } catch (err) {
        return { url, status: "error", detail: err.message };
      }
    })
  );

  const accepted = results.filter((r) => r.status === "ok");
  const rejected = results.filter((r) => r.status !== "ok");

  const embed = new EmbedBuilder()
    .setTitle(`Bulk Submission \u2014 ${urls.length} link(s)`)
    .setColor(rejected.length === 0 ? 0x00c853 : accepted.length === 0 ? 0xf44336 : 0xffc107)
    .setDescription(
      `\u2705 **${accepted.length} accepted**\n\u274C **${rejected.length} rejected**`
    )
    .setTimestamp();

  if (accepted.length > 0) {
    const acceptedList = accepted
      .map((r) => `\`#${r.submission_id}\` \u2014 ${truncate(r.url, 60)}`)
      .slice(0, 10)
      .join("\n");
    embed.addFields({ name: "Accepted", value: acceptedList });
  }

  if (rejected.length > 0) {
    const rejectedList = rejected
      .map((r) => `\u2022 ${truncate(r.url, 50)}\n   \u21B3 ${r.detail}`)
      .slice(0, 10)
      .join("\n");
    embed.addFields({ name: "Rejected", value: rejectedList });
  }

  embed.setFooter({ text: `Campaign #${campaignId}` });

  await interaction.editReply({ embeds: [embed] });
  return true;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n - 1) + "\u2026" : str;
}

module.exports = { handleButton, handleModalSubmit };
