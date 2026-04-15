const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { fetchClipperSubmissions } = require("../api");
const { DATASOURCES } = require("../vouch");

const statusDisplay = {
  awaiting_stats: { icon: "\u23F3", label: "Awaiting Stats", color: 0xffc107 },
  stats_verified: { icon: "\u2705", label: "Stats Verified", color: 0x00c853 },
  paid: { icon: "\uD83D\uDCB0", label: "Paid", color: 0x2196f3 },
  rejected: { icon: "\u274C", label: "Rejected", color: 0xf44336 },
};

const platformIcons = {
  instagram: "\uD83D\uDCF7",
  tiktok: "\uD83C\uDFB5",
  youtube: "\u25B6\uFE0F",
  twitter: "\uD83D\uDC26",
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("mysubmissions")
    .setDescription("View all your submissions")
    .addStringOption((opt) =>
      opt.setName("email").setDescription("Your clipper email").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const email = interaction.options.getString("email");

    let data;
    try {
      data = await fetchClipperSubmissions(email);
    } catch (err) {
      console.error("Fetch submissions error:", err);
      return interaction.editReply("No submissions found, or something went wrong.");
    }

    if (!data.submissions || data.submissions.length === 0) {
      return interaction.editReply("No submissions found for that email.");
    }

    const MAX_SHOWN = 5; // Discord allows max 5 action rows per message
    const slice = data.submissions.slice(0, MAX_SHOWN);

    // Header embed
    const header = new EmbedBuilder()
      .setTitle(`\uD83D\uDCCB  Your Submissions`)
      .setDescription(
        `**${data.total}** total submission(s) for \`${email}\`` +
          (data.total > MAX_SHOWN ? `\n*Showing ${MAX_SHOWN} of ${data.total}.*` : "")
      )
      .setColor(0x7c3aed);

    // One embed + one action row per submission (if unverified + platform supported)
    const embeds = [header];
    const components = [];

    for (const sub of slice) {
      const s =
        statusDisplay[sub.status] ||
        { icon: "\u2753", label: sub.status, color: 0x9e9e9e };
      const pIcon = platformIcons[sub.platform] || "\uD83C\uDF10";

      const statsLine =
        sub.views > 0
          ? `\uD83D\uDC41 \`${sub.views.toLocaleString()}\` views  \u2022  \u2764\uFE0F \`${sub.likes.toLocaleString()}\` likes  \u2022  \uD83D\uDCAC \`${(sub.comments || 0).toLocaleString()}\` comments`
          : "\uD83D\uDD52 Stats pending...";

      const earningsLine =
        sub.est_earnings > 0
          ? `\uD83D\uDCB5 Est: \`$${sub.est_earnings.toFixed(2)}\`` +
            (sub.paid_earnings > 0 ? `  \u2022  Paid: \`$${sub.paid_earnings.toFixed(2)}\`` : "")
          : "";

      const verif =
        sub.verification_status && sub.verification_status !== "pending"
          ? `\uD83D\uDD10 Verification: **${sub.verification_status}**\n`
          : "";

      const embed = new EmbedBuilder()
        .setColor(s.color)
        .setTitle(
          `${pIcon}  ${sub.platform.charAt(0).toUpperCase() + sub.platform.slice(1)}`
        )
        .setDescription(
          `**Status:** ${s.icon} ${s.label}\n` +
            verif +
            `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n` +
            `\uD83D\uDD17 ${sub.post_url}\n\n` +
            statsLine +
            (earningsLine ? `\n${earningsLine}` : "")
        )
        .setFooter({ text: `ID: ${sub.submission_id}` })
        .setTimestamp(new Date(sub.created_at));

      embeds.push(embed);

      // Add a Verify Stats button for unverified submissions on supported platforms
      const isUnverified =
        !sub.verification_status || sub.verification_status === "pending";
      if (isUnverified && DATASOURCES[sub.platform]) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_stats_${sub.submission_id}_${sub.platform}`)
            .setLabel(`\uD83D\uDD10 Verify Stats \u2014 ${sub.platform}`)
            .setStyle(ButtonStyle.Primary)
        );
        components.push(row);
      }
    }

    await interaction.editReply({ embeds, components });
  },
};
