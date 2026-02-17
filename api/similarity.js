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

// ============================================================
// LAYER 2: Robust text filtering
// Catches: exact, plural, possessive, capitalized, partial
// ============================================================
function containsSecret(text, secret) {
  var lower = text.toLowerCase();
  var s = secret.toLowerCase();

  // Check exact word
  if (lower.indexOf(s) !== -1) return true;

  // Check common variations: plural, possessive, -ing, -like, -ish
  var variations = [
    s + "s",       // cardinals
    s + "es",      // foxes
    s + "'s",      // cardinal's
    s + "s'",      // cardinals'
    s + "-like",   // fish-like
    s + "ish",     // piggish
  ];

  // If word ends in consonant+y, check -ies (e.g., puppy -> puppies)
  // If word ends in 'e', check without trailing e for partial matches
  if (s.length > 2) {
    variations.push(s.substring(0, s.length - 1)); // partial: remove last char
    variations.push(s + "ing");
    variations.push(s + "ed");
  }

  for (var i = 0; i < variations.length; i++) {
    if (lower.indexOf(variations[i]) !== -1) return true;
  }

  return false;
}

function stripSecret(text, secret) {
  var s = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Build pattern that catches the word + common suffixes
  var pattern = s + "(?:s|es|'s|s'|-like|ish|ing|ed)?";
  var regex = new RegExp(pattern, "gi");

  return text.replace(regex, "the secret animal");
}

// Fallback reasons by score range (used if AI leaks the secret)
var FALLBACK_REASONS = [
  { min: 0.95, reasons: ["Exact match — you got it!", "That's the one!"] },
  { min: 0.85, reasons: ["Almost the same animal!", "Extremely close — nearly identical!"] },
  { min: 0.70, reasons: ["Close relatives — same family!", "Very closely related animals!"] },
  { min: 0.55, reasons: ["Same group of animals!", "Related — in the same bigger family!"] },
  { min: 0.40, reasons: ["Same type of animal, but pretty different", "Some things in common!"] },
  { min: 0.25, reasons: ["A little bit connected", "Weak connection — keep exploring!"] },
  { min: 0.10, reasons: ["Barely related — very different!", "Not much in common at all"] },
  { min: 0.00, reasons: ["Totally different — nothing in common!", "No connection found!"] },
];

function getFallbackReason(score) {
  for (var i = 0; i < FALLBACK_REASONS.length; i++) {
    if (score >= FALLBACK_REASONS[i].min) {
      var arr = FALLBACK_REASONS[i].reasons;
      return arr[Math.floor(Math.random() * arr.length)];
    }
  }
  return "No connection found!";
}

// ============================================================
// LAYER 1: Prompts designed to avoid leaking
// Key change: we tell the AI to describe ONLY the guess word
// and what TYPE of connection exists, never referencing the target
// ============================================================
var SCORE_PROMPT = [
  'You score how similar a GUESS word is to a hidden TARGET animal for a game.',
  'The audience is kids (age 8+) through adults. Use simple, friendly language.',
  'Return ONLY valid JSON: {"score": NUMBER, "reason": "STRING"}',
  '',
  'The GUESS can be ANY word — animals, places, traits, objects. Score everything!',
  '',
  '*** MOST IMPORTANT RULE ***',
  'Your "reason" must talk ONLY about the GUESS word and the type of connection.',
  'NEVER write the TARGET word anywhere in your response.',
  'NEVER write the TARGET word with an s, es, or any other ending.',
  'NEVER say "the target is..." or "the secret animal is..."',
  'Pretend you do not even know the name of the TARGET.',
  '',
  'Instead of naming the target, use phrases like:',
  '- "the secret animal"',
  '- "the target"',
  '- "it"',
  '',
  'The "reason" explains what connection the AI sees (max 10 words).',
  '',
  'GOOD reasons (NEVER name the target):',
  '- "Both are birds — same animal class!"',
  '- "Both live in the ocean!"',
  '- "Both have fur and four legs"',
  '- "This word describes where the secret animal lives!"',
  '- "Both are popular zoo animals"',
  '- "Same type of animal, different size"',
  '- "One flies, the other swims — very different!"',
  '- "Not related at all — totally different!"',
  '- "A mammal, but a very different kind"',
  '',
  'BAD reasons (these name the target — NEVER DO THIS):',
  '- "Cardinals live in trees" — NAMES THE TARGET! FORBIDDEN!',
  '- "Elephant is much bigger than the target" — NAMES THE TARGET! FORBIDDEN!',
  '- "Dolphins are mammals too" — NAMES THE TARGET! FORBIDDEN!',
  '- "One is a tiger, the other is a bird" — NAMES THE TARGET! FORBIDDEN!',
  '',
  'Scoring: 1.00=exact match, 0.85-0.99=basically the same, 0.70-0.84=close relatives,',
  '0.55-0.69=same group, 0.40-0.54=same type, 0.25-0.39=weak connection,',
  '0.10-0.24=barely related, 0.01-0.09=nothing in common.',
  '',
  'JSON only. No markdown. No backticks.'
].join('\n');

var HINT_PROMPT = [
  'You generate a hint for an animal guessing game.',
  'Given a secret TARGET animal, create a fun clue.',
  'Return ONLY valid JSON: {"hint": "STRING"}',
  '',
  'ABSOLUTE RULE: NEVER name the TARGET animal in your hint.',
  'NEVER use the target word with any ending (s, es, etc).',
  '',
  'Describe the animal using:',
  '- Where it lives',
  '- How big or small it is',
  '- What makes it special or unique',
  '- What it does or eats',
  '- What kind of animal it is',
  '',
  'Make hints fun — like a riddle! One to two sentences max.',
  'Write for kids age 8+ but fun for everyone.',
  '',
  'Examples:',
  '- "This creature lives in the deep ocean and has more arms than you can count on one hand"',
  '- "A small, scaly mammal that curls into a ball when scared — found in Africa and Asia"',
  '- "This Arctic swimmer has a feature that looks like it belongs on a unicorn"',
  '',
  'JSON only. No markdown. No backticks.'
].join('\n');

// ============================================================
// HANDLER
// ============================================================
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

      // LAYER 2+3: Check and filter hint
      var hint = parsed.hint || "";
      if (containsSecret(hint, secret)) {
        hint = stripSecret(hint, secret);
        // If still contains it after stripping, use generic
        if (containsSecret(hint, secret)) {
          hint = "This animal has some very unique features — try thinking about where it lives and what it looks like!";
        }
      }

      return res.status(200).json({ hint: hint });

    } else {
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

      var score = Math.min(1, Math.max(0, parseFloat(parsed.score.toFixed(2))));
      var reason = parsed.reason || "";

      // ============================================================
      // LAYER 2: Check if reason contains secret word
      // LAYER 3: If it does, replace with score-appropriate fallback
      // ============================================================
      if (containsSecret(reason, secret)) {
        reason = getFallbackReason(score);
      }

      // Also check the guess word isn't being used to reference the target
      // (e.g., if guess is "sky" and AI says "Cardinals live in trees")
      // The containsSecret check above handles this already

      return res.status(200).json({
        score: score,
        reason: reason,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
};
