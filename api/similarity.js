var https = require("https");

function callAnthropic(apiKey, modelId, systemPrompt, userMessage) {
  return new Promise(function (resolve, reject) {
    var payload = {
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    };
    // Sonnet 5.5 reasons before answering by default; turn that off to keep guesses fast
    if (modelId.indexOf("sonnet") !== -1) payload.thinking = { type: "between_tools" };
    var body = JSON.stringify(payload);

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
  { min: 10, reasons: ["Exact match — you got it!", "That's the one!"] },
  { min: 9, reasons: ["Almost the same animal!", "Extremely close — nearly identical!"] },
  { min: 8, reasons: ["Close relatives — same family!", "Very closely related animals!"] },
  { min: 6, reasons: ["Same group of animals!", "Related — in the same bigger family!"] },
  { min: 4, reasons: ["Same type of animal, but pretty different", "Some things in common!"] },
  { min: 3, reasons: ["A little bit connected", "Weak connection — keep exploring!"] },
  { min: 2, reasons: ["Barely related — very different!", "Not much in common at all"] },
  { min: 1, reasons: ["Totally different — nothing in common!", "No connection found!"] },
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
  'IMPORTANT: The GUESS can be ANY word — animals, places, traits, habitats, adjectives, objects.',
  'Non-animal words are VALID and should be scored based on how they relate to the TARGET animal.',
  'NEVER say "this is not an animal" or "not an animal name" — every word gets a real score.',
  '',
  'How to score non-animal words:',
  '- Habitat words: "ocean" vs a sea animal = high (7-8). "desert" vs a desert animal = high (7-8).',
  '- Trait words: "stripes" vs zebra = high (7-8). "slow" vs sloth = high (7-8).',
  '- Environment words: "forest" vs a forest animal = high (7-8). "sea" vs a land animal = low (1-2).',
  '- Body parts: "wings" vs a bird = high (7). "scales" vs a fish = high (7).',
  '- Adjectives: "big" vs elephant = moderate (5). "colorful" vs a plain animal = low (2).',
  '- Unrelated objects: "chair" vs any animal = very low (1).',
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
  '- "This is where the secret animal lives!"',
  '- "Both are popular zoo animals"',
  '- "Same type of animal, different size"',
  '- "One flies, the other swims — very different!"',
  '- "Not related at all — totally different!"',
  '- "A mammal, but a very different kind"',
  '- "This describes a key trait of the secret animal!"',
  '- "The secret animal lives in this environment!"',
  '- "Strong habitat connection!"',
  '',
  'BAD reasons (NEVER DO THESE):',
  '- "Cardinals live in trees" — NAMES THE TARGET! FORBIDDEN!',
  '- "Elephant is much bigger than the target" — NAMES THE TARGET! FORBIDDEN!',
  '- "This is not an animal" — NEVER SAY THIS! Every word gets scored!',
  '- "Forest is a place, not an animal" — NEVER SAY THIS!',
  '',
  'Scoring: use a scale from 1 to 10 (integers only, no decimals).',
  '10=exact match, 9=basically the same animal, 8=close relatives,',
  '6-7=same group or strong trait/habitat match, 4-5=same type or moderate connection,',
  '2-3=weak connection, 1=nothing in common.',
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
      ? "claude-sonnet-5-5"
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
        console.error("Anthropic API error", modelId, result.status, JSON.stringify(result.body));
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
        console.error("Anthropic API error", modelId, result.status, JSON.stringify(result.body));
        return res.status(502).json({ error: "API error", detail: result.body });
      }

      var text = result.body.content.map(function (i) { return i.text || ""; }).join("");
      var clean = text.replace(/```json|```/g, "").trim();
      var parsed = JSON.parse(clean);

      var score = Math.min(10, Math.max(1, Math.round(parseFloat(parsed.score))));
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
