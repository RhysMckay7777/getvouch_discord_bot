const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const { createProofRequest, DATASOURCES } = require("../vouch");

const BOT_BASE_URL = process.env.BOT_PUBLIC_URL || "https://getvouch-discord-bot.onrender.com";

// Button custom ID format: verify_stats_<submissionId>_<platform>
async function handleVerifyButton(interaction) {
  if (!interaction.customId.startsWith("verify_stats_")) return false;

  const rest = interaction.customId.replace("verify_stats_", "");
  const lastUnderscore = rest.lastIndexOf("_");
  const submissionId = rest.slice(0, lastUnderscore);
  const platform = rest.slice(lastUnderscore + 1);

  if (!DATASOURCES[platform]) {
    await interaction.reply({
      content: `Verification isn't configured for **${platform}** yet.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const modal = new ModalBuilder()
    .setCustomId(`verify_modal_${submissionId}_${platform}`)
    .setTitle(`Verify ${platform.charAt(0).toUpperCase() + platform.slice(1)} Stats`);

  const handleInput = new TextInputBuilder()
    .setCustomId("platform_handle")
    .setLabel(`Your ${platform} handle / username`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("@yourhandle")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(handleInput));

  await interaction.showModal(modal);
  return true;
}

// Modal custom ID format: verify_modal_<submissionId>_<platform>
async function handleVerifyModal(interaction) {
  if (!interaction.customId.startsWith("verify_modal_")) return false;

  const rest = interaction.customId.replace("verify_modal_", "");
  const lastUnderscore = rest.lastIndexOf("_");
  const submissionId = rest.slice(0, lastUnderscore);
  const platform = rest.slice(lastUnderscore + 1);

  const rawHandle = interaction.fields.getTextInputValue("platform_handle");
  const handle = rawHandle.replace(/^@/, "").trim();

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let result;
  try {
    result = await createProofRequest({
      platform,
      handle,
      submissionId,
      discordUserId: interaction.user.id,
      webhookUrl: `${BOT_BASE_URL}/api/webhook/vouch`,
      redirectBackUrl: `${BOT_BASE_URL}/verify/done`,
    });
  } catch (err) {
    console.error("Vouch proof request error:", err);
    return interaction.editReply(
      "Couldn't create the verification link. Try again or contact an admin."
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("\uD83D\uDD10  Verify Your Stats")
    .setDescription(
      `Click below to verify your **${platform}** account \`@${handle}\`.\n\n` +
        `[\uD83D\uDC49 Open Verification](${result.verificationUrl})\n\n` +
        `*You'll be prompted to install the Vouch browser extension if you don't have it. ` +
        `Once verification completes, you'll get a confirmation DM.*`
    )
    .setColor(0x7c3aed)
    .setFooter({ text: `Submission: ${submissionId}` })
    .setTimestamp();

  try {
    await interaction.user.send({ embeds: [embed] });
    await interaction.editReply("\u2705 I've DM'd you the verification link.");
  } catch {
    await interaction.editReply({ embeds: [embed] });
  }

  return true;
}

module.exports = { handleVerifyButton, handleVerifyModal };
