// backend/server.js
const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();

// Path to the shared SQLite DB file (data/app.db)
const dbPath = path.join(__dirname, '..', 'data', 'app.db');
const db = new Database(dbPath);

// ---------- Middleware ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'web')));

// ---------- DB INIT (safe: IF NOT EXISTS) ----------
function initDatabase() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY,
      kanji TEXT,
      furigana TEXT,
      romaji TEXT,
      meaning TEXT,
      part_of_speech TEXT,
      topic TEXT,
      subtopic TEXT,
      politeness_level TEXT,
      jlpt_level TEXT,
      difficulty TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sentence_templates (
      id INTEGER PRIMARY KEY,
      template_pattern TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS template_slots (
      id INTEGER PRIMARY KEY,
      template_id INTEGER NOT NULL,
      slot_name TEXT NOT NULL,
      grammatical_role TEXT,
      part_of_speech TEXT,
      is_required INTEGER DEFAULT 1,
      order_index INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (template_id) REFERENCES sentence_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generated_sentences (
      id INTEGER PRIMARY KEY,
      template_id INTEGER NOT NULL,
      japanese_sentence TEXT NOT NULL,
      english_sentence TEXT,
      politeness_level TEXT,
      jlpt_level TEXT,
      difficulty TEXT,
      source_tag_id INTEGER,
      is_favorite INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES sentence_templates(id),
      FOREIGN KEY (source_tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS generated_sentence_vocabulary (
      id INTEGER PRIMARY KEY,
      generated_sentence_id INTEGER NOT NULL,
      vocabulary_id INTEGER NOT NULL,
      slot_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (generated_sentence_id) REFERENCES generated_sentences(id) ON DELETE CASCADE,
      FOREIGN KEY (vocabulary_id) REFERENCES vocabulary(id)
    );

    CREATE TABLE IF NOT EXISTS practice_history (
      id INTEGER PRIMARY KEY,
      generated_sentence_id INTEGER NOT NULL,
      practiced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      result TEXT,
      notes TEXT,
      FOREIGN KEY (generated_sentence_id) REFERENCES generated_sentences(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      parent_tag_id INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS taggings (
      id INTEGER PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );

    CREATE TABLE IF NOT EXISTS tag_vocab_mapping (
      id INTEGER PRIMARY KEY,
      tag_id INTEGER NOT NULL,
      vocab_topic TEXT NOT NULL,
      vocab_subtopic TEXT,
      FOREIGN KEY (tag_id) REFERENCES tags(id)
    );
  `);
}

initDatabase();

// ---------- Helpers ----------

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  const idx = Math.floor(Math.random() * arr.length);
  return arr[idx];
}

function aggregateDifficulty(words) {
  const order = { Beginner: 1, Intermediate: 2, Advanced: 3 };
  let maxKey = null;
  let maxVal = 0;
  for (const w of words) {
    const d = w.difficulty;
    if (!d || !order[d]) continue;
    if (order[d] > maxVal) {
      maxVal = order[d];
      maxKey = d;
    }
  }
  return maxKey || null;
}

function aggregateJlpt(words) {
  const order = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };
  let maxKey = null;
  let maxVal = 0;
  for (const w of words) {
    const jlpt = w.jlpt_level;
    if (!jlpt || !order[jlpt]) continue;
    if (order[jlpt] > maxVal) {
      maxVal = order[jlpt];
      maxKey = jlpt;
    }
  }
  return maxKey || null;
}

function aggregatePoliteness(words) {
  const set = new Set(
    words
      .map((w) => w.politeness_level)
      .filter((v) => v && v.trim().length > 0)
  );
  if (set.size === 0) return null;
  if (set.size === 1) return Array.from(set)[0];
  return 'Mixed';
}

function matchesTagMapping(vocabRow, mappings) {
  if (!mappings || mappings.length === 0) return true; // no mapping → no filter
  return mappings.some((m) => {
    if (!m.vocab_topic) return true;
    if (vocabRow.topic !== m.vocab_topic) return false;
    if (m.vocab_subtopic == null) return true;
    return vocabRow.subtopic === m.vocab_subtopic;
  });
}

// ---------- API: Tags ----------

// GET /api/tags?search=&type=
app.get('/api/tags', (req, res) => {
  const { search, type } = req.query;
  let sql = `SELECT * FROM tags WHERE 1=1`;
  const params = [];

  if (type) {
    sql += ` AND type = ?`;
    params.push(type);
  }
  if (search) {
    sql += ` AND name LIKE ?`;
    params.push(`%${search}%`);
  }
  sql += ` ORDER BY name ASC`;

  const tags = db.prepare(sql).all(params);
  res.json({ data: tags });
});

// ---------- API: Sentence templates & slots ----------

// GET /api/sentence-templates?tag_id=&limit=&offset=
app.get('/api/sentence-templates', (req, res) => {
  const { tag_id, limit = 20, offset = 0 } = req.query;
  let where = '1=1';
  const params = [];

  if (tag_id) {
    where += ` AND st.id IN (
      SELECT target_id FROM taggings
      WHERE tag_id = ? AND target_type = 'template'
    )`;
    params.push(tag_id);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM sentence_templates st WHERE ${where}`)
    .get(params).count;

  const rows = db
    .prepare(
      `SELECT st.* FROM sentence_templates st
       WHERE ${where}
       ORDER BY st.updated_at DESC, st.id DESC
       LIMIT ? OFFSET ?`
    )
    .all([...params, Number(limit), Number(offset)]);

  res.json({ data: rows, total });
});

// GET /api/template-slots?template_id=&limit=&offset=
app.get('/api/template-slots', (req, res) => {
  const { template_id, limit = 100, offset = 0 } = req.query;
  if (!template_id) {
    return res.status(400).json({ error: 'template_id is required' });
  }

  const total = db
    .prepare(
      `SELECT COUNT(*) as count FROM template_slots WHERE template_id = ?`
    )
    .get(template_id).count;

  const rows = db
    .prepare(
      `SELECT * FROM template_slots
       WHERE template_id = ?
       ORDER BY order_index ASC, id ASC
       LIMIT ? OFFSET ?`
    )
    .all(template_id, Number(limit), Number(offset));

  res.json({ data: rows, total });
});

// ---------- API: Vocabulary ----------

// GET /api/vocabulary?topic=&subtopic=&politeness=&jlpt=&difficulty=&part_of_speech=&limit=&offset=
app.get('/api/vocabulary', (req, res) => {
  const {
    topic,
    subtopic,
    politeness,
    jlpt,
    difficulty,
    part_of_speech,
    limit = 20,
    offset = 0,
  } = req.query;

  let where = '1=1';
  const params = [];

  if (topic) {
    where += ` AND topic = ?`;
    params.push(topic);
  }
  if (subtopic) {
    where += ` AND subtopic = ?`;
    params.push(subtopic);
  }
  if (politeness) {
    where += ` AND politeness_level = ?`;
    params.push(politeness);
  }
  if (jlpt) {
    where += ` AND jlpt_level = ?`;
    params.push(jlpt);
  }
  if (difficulty) {
    where += ` AND difficulty = ?`;
    params.push(difficulty);
  }
  if (part_of_speech) {
    where += ` AND part_of_speech = ?`;
    params.push(part_of_speech);
  }

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM vocabulary WHERE ${where}`)
    .get(params).count;

  const rows = db
    .prepare(
      `SELECT * FROM vocabulary
       WHERE ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, Number(limit), Number(offset));

  res.json({ data: rows, total });
});

// ---------- API: Tag ↔ vocab mapping overview ----------

// GET /api/tag-mappings
app.get('/api/tag-mappings', (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        t.id as tag_id,
        t.name as tag_name,
        t.type as tag_type,
        parent.name as parent_tag_name,
        m.vocab_topic,
        m.vocab_subtopic,
        t.description
      FROM tag_vocab_mapping m
      JOIN tags t ON t.id = m.tag_id
      LEFT JOIN tags parent ON parent.id = t.parent_tag_id
      ORDER BY t.name ASC
    `
    )
    .all();

  res.json({ data: rows });
});

// ---------- API: Generated sentences + favorites ----------

// GET /api/generated-sentences?tag_id=&politeness=&difficulty=&favorite=&limit=&offset=
app.get('/api/generated-sentences', (req, res) => {
  const {
    tag_id,
    politeness,
    difficulty,
    favorite,
    limit = 20,
    offset = 0,
  } = req.query;

  let where = '1=1';
  const params = [];

  if (tag_id) {
    where += ` AND gs.source_tag_id = ?`;
    params.push(tag_id);
  }
  if (politeness) {
    where += ` AND gs.politeness_level = ?`;
    params.push(politeness);
  }
  if (difficulty) {
    where += ` AND gs.difficulty = ?`;
    params.push(difficulty);
  }
  if (favorite === '1' || favorite === 'true') {
    where += ` AND gs.is_favorite = 1`;
  }

  const total = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM generated_sentences gs
       WHERE ${where}`
    )
    .get(params).count;

  const rows = db
    .prepare(
      `SELECT gs.*, t.name as tag_name
       FROM generated_sentences gs
       LEFT JOIN tags t ON t.id = gs.source_tag_id
       WHERE ${where}
       ORDER BY gs.created_at DESC, gs.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, Number(limit), Number(offset));

  res.json({ data: rows, total });
});

// POST /api/generated-sentences/:id/favorite  { isFavorite: true/false }
app.post('/api/generated-sentences/:id/favorite', (req, res) => {
  const id = Number(req.params.id);
  const { isFavorite } = req.body;

  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const flag = isFavorite ? 1 : 0;
  const stmt = db.prepare(
    `UPDATE generated_sentences SET is_favorite = ? WHERE id = ?`
  );
  const result = stmt.run(flag, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Sentence not found' });
  }

  res.json({ success: true, id, is_favorite: flag });
});

// ---------- API: Practice history (minimal) ----------

// POST /api/practice
// { generatedSentenceId, result, notes }
app.post('/api/practice', (req, res) => {
  const { generatedSentenceId, result, notes } = req.body;
  if (!generatedSentenceId) {
    return res.status(400).json({ error: 'generatedSentenceId is required' });
  }

  const stmt = db.prepare(
    `INSERT INTO practice_history (generated_sentence_id, result, notes)
     VALUES (?, ?, ?)`
  );
  const r = stmt.run(generatedSentenceId, result || null, notes || null);

  res.json({
    success: true,
    id: r.lastInsertRowid,
  });
});

// ---------- API: Sentence generation core ----------

// POST /api/generate
// body: { tagId, templateId (optional), difficulty, jlptLevel, politenessLevel, displayField }
app.post('/api/generate', (req, res) => {
  const {
    tagId,
    templateId: providedTemplateId,
    difficulty,
    jlptLevel,
    politenessLevel,
    displayField = 'furigana', // 'kanji' | 'furigana' | 'romaji' | 'meaning'
  } = req.body;

  if (!tagId) {
    return res.status(400).json({ error: 'tagId is required' });
  }

  // 1) Resolve template: either given or random from tag
  let templateId = providedTemplateId;

  if (!templateId) {
    const candidates = db
      .prepare(
        `
        SELECT st.*
        FROM sentence_templates st
        JOIN taggings tg
          ON tg.target_id = st.id
         AND tg.target_type = 'template'
        WHERE tg.tag_id = ?
          AND st.is_active = 1
      `
      )
      .all(tagId);

    if (!candidates || candidates.length === 0) {
      return res.status(400).json({
        error: 'No active templates linked to this tag',
      });
    }
    const chosenTemplate = pickRandom(candidates);
    templateId = chosenTemplate.id;
  }

  const template = db
    .prepare(`SELECT * FROM sentence_templates WHERE id = ?`)
    .get(templateId);

  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }

  const slots = db
    .prepare(
      `SELECT * FROM template_slots
       WHERE template_id = ?
       ORDER BY order_index ASC, id ASC`
    )
    .all(templateId);

  if (!slots || slots.length === 0) {
    return res.status(400).json({ error: 'Template has no slots defined' });
  }

  // 2) Load tag → vocab topic/subtopic mapping
  const mappings = db
    .prepare(`SELECT * FROM tag_vocab_mapping WHERE tag_id = ?`)
    .all(tagId);

  // 3) For each slot, load candidate vocabulary and pick one
  const usedWords = [];
  const slotChoices = {};

  for (const slot of slots) {
    const baseWhere = ['part_of_speech = ?'];
    const params = [slot.part_of_speech];

    if (difficulty) {
      baseWhere.push('difficulty = ?');
      params.push(difficulty);
    }
    if (politenessLevel) {
      baseWhere.push('politeness_level = ?');
      params.push(politenessLevel);
    }
    if (jlptLevel) {
      baseWhere.push('jlpt_level = ?');
      params.push(jlptLevel);
    }

    const whereSql = baseWhere.join(' AND ');
    const rawCandidates = db
      .prepare(
        `SELECT * FROM vocabulary
         WHERE ${whereSql}`
      )
      .all(params);

    const candidates = rawCandidates.filter((row) =>
      matchesTagMapping(row, mappings)
    );

    if (!candidates || candidates.length === 0) {
      return res.status(400).json({
        error: `No vocabulary candidates found for slot "${slot.slot_name}"`,
        slot: slot.slot_name,
      });
    }

    const chosen = pickRandom(candidates);
    usedWords.push(chosen);
    slotChoices[slot.slot_name] = {
      slot,
      vocab: chosen,
    };
  }

  // 4) Build the final Japanese sentence string
  function wordDisplay(vocab) {
    switch (displayField) {
      case 'kanji':
        return vocab.kanji || vocab.furigana || vocab.romaji || vocab.meaning;
      case 'romaji':
        return vocab.romaji || vocab.furigana || vocab.kanji || vocab.meaning;
      case 'meaning':
        return vocab.meaning || vocab.furigana || vocab.romaji || vocab.kanji;
      case 'furigana':
      default:
        return vocab.furigana || vocab.kanji || vocab.romaji || vocab.meaning;
    }
  }

  let japaneseSentence = template.template_pattern;
  Object.entries(slotChoices).forEach(([slotName, choice]) => {
    const placeholder = `{${slotName}}`;
    japaneseSentence = japaneseSentence.replace(
      new RegExp(placeholder, 'g'),
      wordDisplay(choice.vocab)
    );
  });

  const difficultyAgg = aggregateDifficulty(usedWords);
  const jlptAgg = aggregateJlpt(usedWords);
  const politenessAgg = aggregatePoliteness(usedWords);

  // 5) Insert into generated_sentences
  const insertStmt = db.prepare(
    `INSERT INTO generated_sentences
     (template_id, japanese_sentence, english_sentence,
      politeness_level, jlpt_level, difficulty, source_tag_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const englishSentence = null; // you can create an automatic translation later

  const result = insertStmt.run(
    templateId,
    japaneseSentence,
    englishSentence,
    politenessAgg,
    jlptAgg,
    difficultyAgg,
    tagId
  );

  const generatedId = result.lastInsertRowid;

  // 6) Insert generated_sentence_vocabulary rows
  const vocabStmt = db.prepare(
    `INSERT INTO generated_sentence_vocabulary
     (generated_sentence_id, vocabulary_id, slot_name)
     VALUES (?, ?, ?)`
  );

  for (const [slotName, choice] of Object.entries(slotChoices)) {
    vocabStmt.run(generatedId, choice.vocab.id, slotName);
  }

  const responseTokens = slots.map((slot) => {
    const { vocab } = slotChoices[slot.slot_name];
    return {
      slotName: slot.slot_name,
      vocabularyId: vocab.id,
      partOfSpeech: vocab.part_of_speech,
      kanji: vocab.kanji,
      furigana: vocab.furigana,
      romaji: vocab.romaji,
      meaning: vocab.meaning,
      display: wordDisplay(vocab),
    };
  });

  res.json({
    id: generatedId,
    templateId,
    tagId,
    japaneseSentence,
    englishSentence,
    politenessLevel: politenessAgg,
    jlptLevel: jlptAgg,
    difficulty: difficultyAgg,
    tokens: responseTokens,
  });
});

// ---------- API: Health check ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SentenceLab backend listening on http://localhost:${PORT}`);
});
