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

// SCORING PROMPT: Relationship-focused reasoning (educational, not directional)
var SCORE_PROMPT = [
  'You score similarity between a GUESS word and a hidden TARGET animal for an educational game.',
  'The game teaches how AI understands relationships between concepts.',
  'Return ONLY valid JSON: {"score": NUMBER, "reason": "STRING"}',
  '',
  'The GUESS can be ANY word — animal names, habitats, traits, adjectives, objects, concepts.',
  'Score ALL words based on their semantic relationship to the TARGET. Non-animal words are valid!',
  'Examples: "ocean" vs a sea creature = high score. "stripes" vs zebra = high score.',
  '',
  'ABSOLUTE RULE: "reason" must NEVER contain the TARGET word or directly reveal it.',
  '',
  'The "reason" should explain WHAT TYPE OF RELATIONSHIP the AI detected (max 12 words).',
  'Focus on the connection category, not directional hints.',
  '',
  'CONNECTION TYPES to reference:',
  '- Taxonomy: "Same class (mammals)" or "Same order (primates)"',
  '- Habitat: "Shared aquatic habitat" or "Both found in tropical regions"',
  '- Physical traits: "Similar body covering" or "Size difference but similar build"',
  '- Diet: "Both insectivores" or "Different feeding strategies"',
  '- Behavior: "Both nocturnal" or "Different social structures"',
  '- Defense: "Both use camouflage" or "Different defensive strategies"',
  '- Geographic: "Same continent of origin"',
  '- Cultural: "Both common zoo animals" or "Strong mythological association"',
  '- Symbolic: "Associated with speed/strength/wisdom"',
  '- Sensory: "Similar coloring patterns" or "Very different textures"',
  '- Conceptual: "Strong habitat keyword" or "Trait descriptor match"',
  '',
  'GOOD reasons (explain the relationship type):',
  '- "Same family, different genus — close taxonomic link"',
  '- "Shared ocean habitat, different classes"',
  '- "Physical trait match — both have protective armor"',
  '- "Strong habitat keyword — direct environment connection"',
  '- "Cultural association — both iconic zoo animals"',
  '- "Behavioral link — both are solitary nocturnal hunters"',
  '- "Weak link — different kingdoms entirely"',
  '',
  'BAD reasons (these are directional hints, NOT relationship descriptions):',
  '- "Think smaller and more aquatic" — this is a hint, not a relationship!',
  '- "Head to the ocean instead" — this is a hint!',
  '- "Too furry, think cold-blooded" — this is a hint!',
  '',
  'Scoring: 1.00=exact, 0.85-0.99=same species, 0.70-0.84=same family,',
  '0.55-0.69=same group, 0.40-0.54=same class, 0.25-0.39=weak, 0.10-0.24=distant, 0.01-0.09=unrelated.',
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
  'Make hints fun, intriguing, and helpful. One to two sentences max.',
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
