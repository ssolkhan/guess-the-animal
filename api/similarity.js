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

// SCORING PROMPT: Relationship-focused, friendly teacher tone for kids through adults
var SCORE_PROMPT = [
  'You score how similar a GUESS word is to a hidden TARGET animal for an educational game.',
  'The audience is kids (age 8+), teens, and adults. Use simple, friendly language like a fun teacher.',
  'Return ONLY valid JSON: {"score": NUMBER, "reason": "STRING"}',
  '',
  'The GUESS can be ANY word — animals, places, traits, feelings, objects. Score everything!',
  'Examples: "ocean" vs a sea creature = high score. "stripes" vs zebra = high score.',
  '',
  'ABSOLUTE RULE: "reason" must NEVER contain the TARGET word or reveal what it is.',
  '',
  'The "reason" explains what connection the AI sees (max 10 words). Keep it simple and clear.',
  '',
  'Use everyday language. Imagine explaining to a curious 10-year-old:',
  '- Instead of "Same taxonomic family" say "Same animal family — close relatives!"',
  '- Instead of "Shared primary habitat" say "They live in the same place!"',
  '- Instead of "Different dietary strategies" say "They eat very different foods"',
  '- Instead of "Complex social hierarchies" say "Both live in groups with leaders"',
  '',
  'GOOD reasons (simple, clear, fun):',
  '- "Same animal family — close cousins!"',
  '- "Both live in the ocean!"',
  '- "Both have fur and four legs"',
  '- "This is where the animal lives!"',
  '- "Both are popular zoo animals"',
  '- "Both come out at night"',
  '- "Same type of animal, different size"',
  '- "One flies, the other swims — very different!"',
  '- "Not related at all — totally different worlds"',
  '- "Both have armor or shells for protection"',
  '',
  'BAD reasons (too fancy or giving hints):',
  '- "Both large primates/mammals with complex social hierarchies" — too fancy!',
  '- "Different taxonomic families and dietary strategies" — too science-y!',
  '- "Think smaller and more aquatic" — this is a hint, not a connection!',
  '',
  'Scoring: 1.00=exact match, 0.85-0.99=basically the same animal, 0.70-0.84=close relatives,',
  '0.55-0.69=same group, 0.40-0.54=same type of animal, 0.25-0.39=weak connection,',
  '0.10-0.24=barely related, 0.01-0.09=nothing in common.',
  '',
  'JSON only. No markdown. No backticks.'
].join('\n');

// HINT PROMPT: Directional clue (gameplay help, not educational)
var HINT_PROMPT = [
  'You are a hint generator for an animal guessing game.',
  'Given a secret TARGET animal, generate a helpful directional clue.',
  'Return ONLY valid JSON: {"hint": "STRING"}',
  '',
  'ABSOLUTE RULE: NEVER name the TARGET animal in your hint.',
  '',
  'The hint should guide players toward the answer using:',
  '- Habitat: where it lives',
  '- Size: how big or small',
  '- Distinctive features: what makes it unique',
  '- Behavior: what it does',
  '- Category: what kind of animal it is',
  '',
  'Make hints fun and exciting — like a riddle! One to two sentences max.',
  'Write for kids age 8+ but make it fun for everyone.',
  '',
  'Examples:',
  '- "This creature lives in the deep ocean and has more arms than you can count on one hand"',
  '- "Look for a small, scaly mammal that curls into a ball when scared — found in Africa and Asia"',
  '- "This Arctic swimmer has a feature that looks like it belongs on a unicorn"',
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
    var action = body.action || "score";
    var model = body.model;

    var modelId = model === "sonnet"
      ? "claude-sonnet-4-20250514"
      : "claude-haiku-4-5-20251001";

    var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: "API key not configured" });
    }

    if (action === "hint") {
      // Generate directional hint for the secret animal
      var secret = body.secret;
      if (!secret) return res.status(400).json({ error: "Missing secret" });

      var result = await callAnthropic(
        ANTHROPIC_API_KEY, modelId, HINT_PROMPT,
        'TARGET: "' + secret + '"'
      );

      if (result.status !== 200) {
        return res.status(502).json({ error: "API error", detail: result.body });
      }

      var text = result.body.content.map(function (i) { return i.text || ""; }).join("");
      var clean = text.replace(/```json|```/g, "").trim();
      var parsed = JSON.parse(clean);

      // Safety: strip secret word from hint
      var hint = parsed.hint || "";
      var escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var regex = new RegExp("\\b" + escaped + "\\b", "gi");
      hint = hint.replace(regex, "???");

      return res.status(200).json({ hint: hint });

    } else {
      // Score a guess
      var guess = body.guess;
      var secret = body.secret;
      if (!guess || !secret) return res.status(400).json({ error: "Missing guess or secret" });

      var result = await callAnthropic(
        ANTHROPIC_API_KEY, modelId, SCORE_PROMPT,
        'GUESS: "' + guess + '"\nTARGET: "' + secret + '"'
      );

      if (result.status !== 200) {
        return res.status(502).json({ error: "API error", detail: result.body });
      }

      var text = result.body.content.map(function (i) { return i.text || ""; }).join("");
      var clean = text.replace(/```json|```/g, "").trim();
      var parsed = JSON.parse(clean);

      // Safety: strip secret word from reason
      var reason = parsed.reason || "";
      var escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var regex = new RegExp("\\b" + escaped + "\\b", "gi");
      reason = reason.replace(regex, "???");

      return res.status(200).json({
        score: Math.min(1, Math.max(0, parseFloat(parsed.score.toFixed(2)))),
        reason: reason,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
};
