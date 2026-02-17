const https = require("https");

function callAnthropic(apiKey, modelId, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: modelId,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error("Failed to parse: " + data.substring(0, 500)));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { guess, secret, model } = req.body || {};

    if (!guess || !secret) {
      return res.status(400).json({ error: "Missing guess or secret" });
    }

    const modelId = model === "sonnet"
      ? "claude-sonnet-4-20250514"
      : "claude-haiku-4-5-20251001";

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "API key not configured" });
    }

    const systemPrompt = `You are a semantic similarity scorer for an educational game where players guess a secret animal. Return ONLY a JSON object with "score" (0.00-1.00) and "reason" (max 15 words).

CRITICAL: The "reason" must NEVER name or directly hint at the secret word. But it SHOULD give useful directional clues to help the player get closer. Think of yourself as a "warmer/colder" guide.

GOOD REASONING EXAMPLES (helpful, directional, engaging):
- guess "tiger", secret "chameleon": "Right kingdom, but think smaller, slower, and much better at hiding"
- guess "fish", secret "octopus": "You're in the right habitat! Think more tentacles, no bones"
- guess "eagle", secret "penguin": "Correct class! But this one traded flying for swimming"
- guess "dog", secret "gecko": "Way too big and furry — think tiny, scaly, and tropical"
- guess "forest", secret "seahorse": "Wrong environment — think saltwater and coral reefs"
- guess "spots", secret "narwhal": "No spots here — think horn, Arctic, and ocean deep"

BAD REASONING (too vague, unhelpful):
- "Both are animals but different classifications"
- "Both predatory animals from different groups"
- "Similar but different habitats"

The reason should help players think about: size, habitat, body features, behavior, climate, taxonomy. Be specific about HOW the guess differs without naming the secret.

Scoring guidelines:
- 1.00: exact match
- 0.85-0.99: same species or extremely close variant
- 0.70-0.84: same family or very closely related
- 0.55-0.69: same broader group or strong association
- 0.40-0.54: same class or moderate association
- 0.25-0.39: weak connection
- 0.10-0.24: very distant connection
- 0.01-0.09: essentially unrelated

Respond ONLY with valid JSON, no markdown.`;

    const result = await callAnthropic(
      ANTHROPIC_API_KEY,
      modelId,
      systemPrompt,
      'Guess word: "' + guess + '"\nSecret word: "' + secret + '"'
    );

    if (result.status !== 200) {
      return res.status(502).json({ error: "API error", detail: result.body });
    }

    const text = result.body.content.map(function(i) { return i.text || ""; }).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({
      score: Math.min(1, Math.max(0, parseFloat(parsed.score.toFixed(2)))),
      reason: parsed.reason || "",
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
};
