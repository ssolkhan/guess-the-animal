var https = require("https");

function callAnthropic(apiKey, modelId, systemPrompt, userMessage) {
  return new Promise(function (resolve, reject) {
    var body = JSON.stringify({
      model: modelId,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    var options = {
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

    var req = https.request(options, function (response) {
      var data = "";
      response.on("data", function (chunk) { data += chunk; });
      response.on("end", function () {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(data) });
        } catch (e) {
          reject(new Error("Parse failed: " + data.substring(0, 500)));
        }
      });
    });

    req.on("error", function (e) { reject(e); });
    req.write(body);
    req.end();
  });
}

var SYSTEM_PROMPT = [
  'You score similarity between a GUESS and a hidden TARGET for a guessing game.',
  'Return ONLY valid JSON: {"score": NUMBER, "reason": "STRING"}',
  '',
  'ABSOLUTE RULE: Your "reason" must NEVER contain the TARGET word. Not even once.',
  'ABSOLUTE RULE: Your "reason" must NEVER contrast GUESS vs TARGET by naming both.',
  '',
  'Your reason should ONLY talk about the GUESS and give directional hints like:',
  '- "Think smaller and more aquatic"',
  '- "Right class! But this one has scales and changes color"',
  '- "Too furry — think cold-blooded and tropical"',
  '- "Land predator — head to the ocean instead"',
  '- "Close! Same family but think something with a shell"',
  '- "Wrong habitat — try the Arctic"',
  '',
  'WRONG (these reveal the target — NEVER do this):',
  '- "Tiger hunts on land while [target] lives underwater" — names the target!',
  '- "Whale breathes air but [target] uses gills" — names the target!',
  '- "Both aquatic but [target] has tentacles" — names the target!',
  '',
  'Only describe the GUESS. Give direction using hints about size, habitat, body type, climate, or taxonomy.',
  '',
  'Scoring: 1.00=exact, 0.85-0.99=same species, 0.70-0.84=same family,',
  '0.55-0.69=same group, 0.40-0.54=same class, 0.25-0.39=weak, 0.10-0.24=distant, 0.01-0.09=unrelated.',
  '',
  'JSON only. No markdown. No backticks.'
].join('\n');

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body || {};
    var guess = body.guess;
    var secret = body.secret;
    var model = body.model;

    if (!guess || !secret) {
      return res.status(400).json({ error: "Missing guess or secret" });
    }

    var modelId = model === "sonnet"
      ? "claude-sonnet-4-20250514"
      : "claude-haiku-4-5-20251001";

    var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "API key not configured" });
    }

    var result = await callAnthropic(
      ANTHROPIC_API_KEY,
      modelId,
      SYSTEM_PROMPT,
      'GUESS: "' + guess + '"\nTARGET: "' + secret + '"'
    );

    if (result.status !== 200) {
      return res.status(502).json({ error: "API error", detail: result.body });
    }

    var text = result.body.content.map(function (i) { return i.text || ""; }).join("");
    var clean = text.replace(/```json|```/g, "").trim();
    var parsed = JSON.parse(clean);

    // SAFETY NET: Strip any mention of the secret word from the reason
    var reason = parsed.reason || "";
    var escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var regex = new RegExp("\\b" + escaped + "\\b", "gi");
    reason = reason.replace(regex, "???");

    return res.status(200).json({
      score: Math.min(1, Math.max(0, parseFloat(parsed.score.toFixed(2)))),
      reason: reason,
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
};
