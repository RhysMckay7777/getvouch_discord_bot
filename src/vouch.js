const VOUCH_BASE = "https://app.getvouch.io";

// Data source IDs per platform. Override these via env vars when the real ones
// come from the Vouch dashboard. Instagram default is from the public docs example.
const DATASOURCES = {
  instagram: process.env.VOUCH_DATASOURCE_INSTAGRAM || "687d6f6f-5346-4fb1-9552-222d4a225451",
  tiktok: process.env.VOUCH_DATASOURCE_TIKTOK,
  youtube: process.env.VOUCH_DATASOURCE_YOUTUBE,
  twitter: process.env.VOUCH_DATASOURCE_TWITTER || "12ea08f3-ae24-4bce-bf2c-6f59459b40b2",
};

// Input-field-name per platform (what Vouch expects in the `inputs` object).
const HANDLE_FIELD = {
  instagram: "ig_handle",
  tiktok: "tiktok_username",
  youtube: "youtube_channel",
  twitter: "twitter_username",
};

function encodeInputs(inputs) {
  return Buffer.from(JSON.stringify(inputs)).toString("base64");
}

function packMetadata({ submissionId, discordUserId }) {
  // Vouch metadata max 256 chars. Pipe-delimited, URL-safe format.
  return `${submissionId}|${discordUserId}`;
}

function unpackMetadata(metadataStr) {
  if (!metadataStr || typeof metadataStr !== "string") {
    return { submissionId: null, discordUserId: null };
  }
  const [submissionId, discordUserId] = metadataStr.split("|");
  return { submissionId: submissionId || null, discordUserId: discordUserId || null };
}

/**
 * Create a Vouch proof request and return a verification URL.
 */
async function createProofRequest({
  platform,
  handle,
  submissionId,
  discordUserId,
  webhookUrl,
  redirectBackUrl,
}) {
  const datasourceId = DATASOURCES[platform];
  if (!datasourceId) {
    throw new Error(`No Vouch data source configured for platform "${platform}"`);
  }

  const handleField = HANDLE_FIELD[platform];
  const body = {
    customerId: process.env.VOUCH_CUSTOMER_ID,
    datasourceId,
    redirectBackUrl,
    webhookUrl,
    metadata: packMetadata({ submissionId, discordUserId }),
    inputs: encodeInputs({ [handleField]: handle }),
  };

  const res = await fetch(`${VOUCH_BASE}/api/proof-request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOUCH_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Vouch error ${res.status}: ${JSON.stringify(data)}`);
  }

  return { verificationUrl: data.verificationUrl, requestId: data.requestId };
}

module.exports = { createProofRequest, unpackMetadata, DATASOURCES };
