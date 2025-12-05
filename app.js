// web/app.js

// ------------- Basic DOM helpers -------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function createElem(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

// ------------- Global state -------------

const state = {
  tags: [],
  currentTagId: null,
  currentSubTagId: null,
  currentSentence: null, // { id, tokens, japaneseSentence, ... }

  lists: {
    vocabulary: { page: 1, pageSize: 20, totalPages: 1 },
    templates: { page: 1, pageSize: 20, totalPages: 1 },
    sentenceLibrary: { page: 1, pageSize: 20, totalPages: 1 },
  },
};

// ------------- Sidebar & layout -------------

const navItems = $$('.nav__item');
const sections = $$('.page-section');
const sidebar = $('#sidebar');
const overlay = $('#overlay');
const menuToggle = $('#menuToggle');

navItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = item.dataset.target;
    sections.forEach((section) => {
      section.classList.toggle('hidden', section.id !== target);
    });
    navItems.forEach((link) =>
      link.classList.toggle('active', link === item)
    );

    sidebar.classList.remove('sidebar--open');
    overlay.classList.remove('overlay--visible');

    if (target === 'settings') {
      loadSettingsDataOnce();
    }
  });
});

menuToggle.addEventListener('click', () => {
  sidebar.classList.toggle('sidebar--open');
  overlay.classList.toggle('overlay--visible');
});

overlay.addEventListener('click', () => {
  sidebar.classList.remove('sidebar--open');
  overlay.classList.remove('overlay--visible');
});

// ------------- Sentence generator -------------

const tagSelect = $('#tagSelect');
const subTagSelect = $('#subTagSelect');
const politenessSelect = $('#politenessSelect');
const difficultySelect = $('#difficultySelect');
const jlptSelect = $('#jlptSelect');
const generateButton = $('#generateButton');
const generatedList = $('#generatedList');
const generatedEmptyState = $('#generatedEmptyState');
const sentenceDisplay = $('#sentenceDisplay');
const favoriteButton = $('#favoriteButton');
const rollButton = $('#rollButton');
const generatedHint = $('#generatedHint');

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error : `POST ${url} failed`;
    throw new Error(msg);
  }
  return data;
}

// Load tags and fill selects
async function loadTags() {
  try {
    const { data } = await apiGet('/api/tags');
    state.tags = data || [];

    // top-level = parent_tag_id null
    const topLevel = state.tags.filter((t) => t.parent_tag_id == null);

    tagSelect.innerHTML = '<option value="">Select tag</option>';
    topLevel.forEach((tag) => {
      const opt = createElem('option', null, tag.name);
      opt.value = String(tag.id);
      tagSelect.appendChild(opt);
    });

    subTagSelect.innerHTML = '<option value="">Select sub tag</option>';
    subTagSelect.disabled = true;
  } catch (err) {
    console.error(err);
    tagSelect.innerHTML =
      '<option value="">Error loading tags (check console)</option>';
  }
}

function updateSubTagSelect(parentId) {
  const parentIdNum = parentId ? Number(parentId) : null;
  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === parentIdNum
  );

  subTagSelect.innerHTML = '<option value="">Select sub tag</option>';
  if (!parentIdNum || children.length === 0) {
    subTagSelect.disabled = true;
    return;
  }

  children.forEach((tag) => {
    const opt = createElem('option', null, tag.name);
    opt.value = String(tag.id);
    subTagSelect.appendChild(opt);
  });
  subTagSelect.disabled = false;
}

tagSelect.addEventListener('change', () => {
  state.currentTagId = tagSelect.value || null;
  state.currentSubTagId = null;
  subTagSelect.value = '';
  updateSubTagSelect(state.currentTagId);
});

subTagSelect.addEventListener('change', () => {
  state.currentSubTagId = subTagSelect.value || null;
});

// Render sentence as clickable words (each token is fixed for now)
function renderSentenceTokens(tokens) {
  sentenceDisplay.innerHTML = '';
  if (!tokens || tokens.length === 0) {
    const span = createElem('span', 'generated__hint', 'No sentence selected.');
    sentenceDisplay.appendChild(span);
    return;
  }

  tokens.forEach((token) => {
    const wrapper = createElem('div', 'word');
    const button = createElem('button', 'word__button', token.display || '');
    button.type = 'button';
    wrapper.appendChild(button);
    sentenceDisplay.appendChild(wrapper);
  });
}

function addSentenceToHistoryList(sentenceData) {
  // Remove empty state if present
  if (generatedEmptyState) {
    generatedEmptyState.remove();
  }

  const item = createElem('li', 'generated__item');
  const textSpan = createElem('span', 'generated__text', sentenceData.japaneseSentence);

  const useBtn = createElem(
    'button',
    'button button--ghost generated__button',
    'Use'
  );
  useBtn.type = 'button';
  useBtn.addEventListener('click', () => {
    state.currentSentence = sentenceData;
    renderSentenceTokens(sentenceData.tokens);
    updateFavoriteButton();
    sentenceDisplay.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  item.appendChild(textSpan);
  item.appendChild(useBtn);
  generatedList.prepend(item); // newest on top
}

function updateFavoriteButton() {
  const s = state.currentSentence;
  const isFav = s && s.is_favorite;
  favoriteButton.setAttribute('aria-pressed', isFav ? 'true' : 'false');
  favoriteButton.classList.toggle('button--favorite', !!isFav);
}

// Generate sentence
generateButton.addEventListener('click', async () => {
  const baseTagId = state.currentSubTagId || state.currentTagId;
  if (!baseTagId) {
    alert('Please select at least a Tag.');
    return;
  }

  const body = {
    tagId: Number(baseTagId),
    difficulty: difficultySelect.value || null,
    jlptLevel: jlptSelect.value || null,
    politenessLevel: politenessSelect.value || null,
    displayField: 'furigana',
  };

  generateButton.disabled = true;
  generateButton.textContent = 'Generating...';

  try {
    const data = await apiPost('/api/generate', body);
    const extended = { ...data, is_favorite: 0 }; // backend default is 0
    state.currentSentence = extended;
    renderSentenceTokens(extended.tokens);
    addSentenceToHistoryList(extended);
    updateFavoriteButton();
    generatedHint.textContent = 'Sentences you generate will appear here.';
  } catch (err) {
    console.error(err);
    alert(err.message);
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = 'Generate';
  }
});

// Roll = generate another sentence using the same filters & last tag
rollButton.addEventListener('click', async () => {
  const baseTagId = state.currentSubTagId || state.currentTagId;
  if (!baseTagId) {
    alert('Pick a Tag before rolling.');
    return;
  }
  try {
    const data = await apiPost('/api/generate', {
      tagId: Number(baseTagId),
      difficulty: difficultySelect.value || null,
      jlptLevel: jlptSelect.value || null,
      politenessLevel: politenessSelect.value || null,
      displayField: 'furigana',
    });
    const extended = { ...data, is_favorite: 0 };
    state.currentSentence = extended;
    renderSentenceTokens(extended.tokens);
    addSentenceToHistoryList(extended);
    updateFavoriteButton();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// Favorite toggle
favoriteButton.addEventListener('click', async () => {
  const sentence = state.currentSentence;
  if (!sentence || !sentence.id) return;

  const newFav = !sentence.is_favorite;

  try {
    await apiPost(`/api/generated-sentences/${sentence.id}/favorite`, {
      isFavorite: newFav,
    });
    sentence.is_favorite = newFav ? 1 : 0;
    updateFavoriteButton();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

// ------------- Settings: shared helpers -------------

let settingsLoaded = false;

function ensurePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function openFullList(tileId) {
  const url = new URL(window.location.href);
  url.searchParams.set('fullTile', tileId);
  url.hash = tileId;
  window.open(url.toString(), '_blank');
}

$$('.pagination__full').forEach((btn) => {
  btn.addEventListener('click', () => openFullList(btn.dataset.tile));
});

// ------------- Settings: Vocabulary -------------

const vocabTopicFilter = $('#vocabTopicFilter');
const vocabSubtopicFilter = $('#vocabSubtopicFilter');
const vocabPolitenessFilter = $('#vocabPolitenessFilter');
const vocabJlptFilter = $('#vocabJlptFilter');
const vocabDifficultyFilter = $('#vocabDifficultyFilter');
const vocabTableBody = $('#vocabTableBody');
const vocabPaginationInfo = $('#vocabPaginationInfo');
const vocabPaginationPage = $('#vocabPaginationPage');

async function loadVocabularyPage() {
  const listState = state.lists.vocabulary;
  const page = ensurePositiveInt(listState.page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (page - 1) * pageSize);

  if (vocabTopicFilter.value) params.set('topic', vocabTopicFilter.value);
  if (vocabSubtopicFilter.value)
    params.set('subtopic', vocabSubtopicFilter.value);
  if (vocabPolitenessFilter.value)
    params.set('politeness', vocabPolitenessFilter.value);
  if (vocabJlptFilter.value) params.set('jlpt', vocabJlptFilter.value);
  if (vocabDifficultyFilter.value)
    params.set('difficulty', vocabDifficultyFilter.value);

  try {
    const { data, total } = await apiGet(`/api/vocabulary?${params.toString()}`);
    vocabTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No vocabulary found for current filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      vocabTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        c0.appendChild(checkbox);

        const wordText =
          row.furigana || row.kanji || row.romaji || row.meaning || '(empty)';
        const c1 = createElem('div', 'table__cell', wordText);
        const c2 = createElem(
          'div',
          'table__cell',
          `${row.topic || '-'} / ${row.subtopic || '-'}`
        );
        const c3 = createElem('div', 'table__cell', row.difficulty || '-');
        const c4 = createElem('div', 'table__cell', row.updated_at || '-');

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);

        vocabTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(page, totalPages);

    vocabPaginationInfo.textContent = `Total ${total} vocab item(s) – page size ${pageSize}`;
    vocabPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    vocabPaginationInfo.textContent = 'Error loading vocabulary.';
  }
}

$$('.pagination__button[data-tile="vocabulary"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.vocabulary;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadVocabularyPage();
  });
});

[
  vocabTopicFilter,
  vocabSubtopicFilter,
  vocabPolitenessFilter,
  vocabJlptFilter,
  vocabDifficultyFilter,
].forEach((el) =>
  el.addEventListener('change', () => {
    state.lists.vocabulary.page = 1;
    loadVocabularyPage();
  })
);

// ------------- Settings: Sentence templates -------------

const templatesTagFilter = $('#templatesTagFilter');
const templatesSubTagFilter = $('#templatesSubTagFilter');
const templatesTableBody = $('#templatesTableBody');
const templatesPaginationInfo = $('#templatesPaginationInfo');
const templatesPaginationPage = $('#templatesPaginationPage');

function fillTagFiltersForSettings() {
  const topLevel = state.tags.filter((t) => t.parent_tag_id == null);
  const allSub = state.tags.filter((t) => t.parent_tag_id != null);

  templatesTagFilter.innerHTML = '<option value="">Tag (any)</option>';
  topLevel.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    templatesTagFilter.appendChild(opt);
  });
  templatesSubTagFilter.innerHTML = '<option value="">Subtag (any)</option>';

  libraryTagFilter.innerHTML = '<option value="">Tag (any)</option>';
  librarySubTagFilter.innerHTML = '<option value="">Sub Tag (any)</option>';
  topLevel.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    libraryTagFilter.appendChild(opt);
  });
  // sub-tags for library will be updated on change
}

templatesTagFilter.addEventListener('change', () => {
  const parentId = templatesTagFilter.value || null;
  templatesSubTagFilter.innerHTML = '<option value="">Subtag (any)</option>';

  if (!parentId) return;
  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === Number(parentId)
  );
  children.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    templatesSubTagFilter.appendChild(opt);
  });
  state.lists.templates.page = 1;
  loadTemplatesPage();
});

templatesSubTagFilter.addEventListener('change', () => {
  state.lists.templates.page = 1;
  loadTemplatesPage();
});

async function loadTemplatesPage() {
  const listState = state.lists.templates;
  const page = ensurePositiveInt(listState.page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (page - 1) * pageSize);

  const tagId = templatesSubTagFilter.value || templatesTagFilter.value;
  if (tagId) params.set('tag_id', tagId);

  try {
    const { data, total } = await apiGet(
      `/api/sentence-templates?${params.toString()}`
    );
    templatesTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No sentence templates for current filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      templatesTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        c0.appendChild(checkbox);

        const c1 = createElem('div', 'table__cell', row.template_pattern || '');
        const c2 = createElem('div', 'table__cell', row.description || '-');
        const c3 = createElem(
          'div',
          'table__cell',
          row.is_active ? 'Yes' : 'No'
        );
        const c4 = createElem('div', 'table__cell', row.updated_at || '-');

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);

        templatesTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(page, totalPages);

    templatesPaginationInfo.textContent = `Total ${total} template(s) – page size ${pageSize}`;
    templatesPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    templatesPaginationInfo.textContent = 'Error loading templates.';
  }
}

$$('.pagination__button[data-tile="sentence-templates"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.templates;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadTemplatesPage();
  });
});

// ------------- Settings: Tags & mapping -------------

const tagsMappingTableBody = $('#tagsMappingTableBody');
const tagsMappingPaginationInfo = $('#tagsMappingPaginationInfo');

async function loadTagMappings() {
  try {
    const { data } = await apiGet('/api/tag-mappings');
    tagsMappingTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No tag mappings defined yet.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      tagsMappingTableBody.appendChild(row);
      tagsMappingPaginationInfo.textContent = 'No mappings.';
      return;
    }

    data.forEach((row) => {
      const tr = createElem('div', 'table__row');
      const c0 = createElem('div', 'table__cell');
      const checkbox = createElem('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = true;
      c0.appendChild(checkbox);

      const c1 = createElem('div', 'table__cell', row.tag_name || '');
      const c2 = createElem(
        'div',
        'table__cell',
        row.parent_tag_name || '-'
      );
      const mappedTo = row.vocab_topic
        ? `${row.vocab_topic} / ${row.vocab_subtopic || 'ALL'}`
        : '-';
      const c3 = createElem('div', 'table__cell', mappedTo);
      const c4 = createElem('div', 'table__cell', row.description || '-');

      tr.appendChild(c0);
      tr.appendChild(c1);
      tr.appendChild(c2);
      tr.appendChild(c3);
      tr.appendChild(c4);
      tagsMappingTableBody.appendChild(tr);
    });

    tagsMappingPaginationInfo.textContent = `Loaded ${data.length} mapping(s).`;
  } catch (err) {
    console.error(err);
    tagsMappingPaginationInfo.textContent = 'Error loading mappings.';
  }
}

// ------------- Settings: Sentence library -------------

const libraryTagFilter = $('#libraryTagFilter');
const librarySubTagFilter = $('#librarySubTagFilter');
const libraryPolitenessFilter = $('#libraryPolitenessFilter');
const libraryDifficultyFilter = $('#libraryDifficultyFilter');
const sentenceLibraryTableBody = $('#sentenceLibraryTableBody');
const libraryPaginationInfo = $('#libraryPaginationInfo');
const libraryPaginationPage = $('#libraryPaginationPage');

libraryTagFilter.addEventListener('change', () => {
  const parentId = libraryTagFilter.value || null;
  librarySubTagFilter.innerHTML = '<option value="">Sub Tag (any)</option>';

  if (!parentId) {
    loadSentenceLibraryPage(1);
    return;
  }

  const children = state.tags.filter(
    (t) => t.parent_tag_id != null && Number(t.parent_tag_id) === Number(parentId)
  );
  children.forEach((t) => {
    const opt = createElem('option', null, t.name);
    opt.value = String(t.id);
    librarySubTagFilter.appendChild(opt);
  });

  loadSentenceLibraryPage(1);
});

[
  librarySubTagFilter,
  libraryPolitenessFilter,
  libraryDifficultyFilter,
].forEach((el) =>
  el.addEventListener('change', () => loadSentenceLibraryPage(1))
);

async function loadSentenceLibraryPage(page) {
  const listState = state.lists.sentenceLibrary;
  listState.page = ensurePositiveInt(page, 1);
  const pageSize = listState.pageSize;

  const params = new URLSearchParams();
  params.set('limit', pageSize);
  params.set('offset', (listState.page - 1) * pageSize);

  const tagId = librarySubTagFilter.value || libraryTagFilter.value;
  if (tagId) params.set('tag_id', tagId);
  if (libraryPolitenessFilter.value)
    params.set('politeness', libraryPolitenessFilter.value);
  if (libraryDifficultyFilter.value)
    params.set('difficulty', libraryDifficultyFilter.value);

  try {
    const { data, total } = await apiGet(
      `/api/generated-sentences?${params.toString()}`
    );
    sentenceLibraryTableBody.innerHTML = '';

    if (!data || data.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No generated sentences yet for these filters.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      sentenceLibraryTableBody.appendChild(row);
    } else {
      data.forEach((row) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        c0.appendChild(checkbox);

        const c1 = createElem(
          'div',
          'table__cell',
          row.japanese_sentence || ''
        );
        const c2 = createElem('div', 'table__cell', row.tag_name || '-');
        const c3 = createElem(
          'div',
          'table__cell',
          row.politeness_level || '-'
        );
        const c4 = createElem('div', 'table__cell', row.difficulty || '-');
        const c5 = createElem(
          'div',
          'table__cell',
          row.is_favorite ? '❤️' : '♡'
        );

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);
        tr.appendChild(c5);

        sentenceLibraryTableBody.appendChild(tr);
      });
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    listState.totalPages = totalPages;
    listState.page = Math.min(listState.page, totalPages);

    libraryPaginationInfo.textContent = `Total ${total} sentence(s) – page size ${pageSize}`;
    libraryPaginationPage.textContent = `${listState.page} / ${totalPages}`;
  } catch (err) {
    console.error(err);
    libraryPaginationInfo.textContent = 'Error loading sentence library.';
  }
}

$$('.pagination__button[data-tile="sentence-library"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const dir = btn.dataset.dir;
    const listState = state.lists.sentenceLibrary;
    if (dir === 'prev') {
      listState.page = Math.max(1, listState.page - 1);
    } else if (dir === 'next') {
      listState.page = Math.min(listState.totalPages, listState.page + 1);
    }
    loadSentenceLibraryPage(listState.page);
  });
});

// ------------- Settings: Slots viewer (simple) -------------

const slotsTableBody = $('#slotsTableBody');

async function loadSlotsForCurrentTemplatesSample() {
  slotsTableBody.innerHTML = '';

  // Simple heuristic: load slots for first templates page (already loaded)
  try {
    const firstTemplatesRes = await apiGet(
      `/api/sentence-templates?limit=5&offset=0`
    );
    const templates = firstTemplatesRes.data || [];
    if (templates.length === 0) {
      const row = createElem('div', 'table__row');
      const cell = createElem(
        'div',
        'table__cell',
        'No templates yet → no slots.'
      );
      cell.style.gridColumn = '1 / -1';
      row.appendChild(cell);
      slotsTableBody.appendChild(row);
      return;
    }

    for (const tmpl of templates) {
      const { data: slots } = await apiGet(
        `/api/template-slots?template_id=${tmpl.id}`
      );
      slots.forEach((slot) => {
        const tr = createElem('div', 'table__row');
        const c0 = createElem('div', 'table__cell');
        const checkbox = createElem('input');
        checkbox.type = 'checkbox';
        checkbox.disabled = true;
        c0.appendChild(checkbox);

        const c1 = createElem('div', 'table__cell', slot.slot_name || '');
        const c2 = createElem(
          'div',
          'table__cell',
          slot.grammatical_role || '-'
        );
        const c3 = createElem(
          'div',
          'table__cell',
          slot.part_of_speech || '-'
        );
        const c4 = createElem(
          'div',
          'table__cell',
          tmpl.template_pattern || ''
        );

        tr.appendChild(c0);
        tr.appendChild(c1);
        tr.appendChild(c2);
        tr.appendChild(c3);
        tr.appendChild(c4);
        slotsTableBody.appendChild(tr);
      });
    }
  } catch (err) {
    console.error(err);
    const row = createElem('div', 'table__row');
    const cell = createElem('div', 'table__cell', 'Error loading slots.');
    cell.style.gridColumn = '1 / -1';
    row.appendChild(cell);
    slotsTableBody.appendChild(row);
  }
}

// ------------- Settings: One-time loader -------------

async function loadSettingsDataOnce() {
  if (settingsLoaded) return;
  settingsLoaded = true;

  // Fill tag-based filters
  fillTagFiltersForSettings();

  // Load vocabulary, templates, mappings, sentence library, slots
  await Promise.all([
    loadVocabularyPage(),
    loadTemplatesPage(),
    loadTagMappings(),
    loadSentenceLibraryPage(1),
    loadSlotsForCurrentTemplatesSample(),
  ]);
}

// ------------- Full-tile logic for open-in-new-tab -------------

(function handleFullTileMode() {
  const params = new URLSearchParams(window.location.search);
  const fullTile = params.get('fullTile');
  if (!fullTile) return;

  sections.forEach((section) => {
    section.classList.toggle('hidden', section.id !== 'settings');
  });
  navItems.forEach((link) =>
    link.classList.toggle('active', link.dataset.target === 'settings')
  );

  $$('.tile').forEach((tile) => {
    if (tile.id && tile.id !== fullTile) {
      tile.classList.add('hidden');
    } else if (tile.id === fullTile) {
      tile.classList.add('tile--full');
      const pagination = tile.querySelector('.pagination');
      if (pagination) pagination.classList.add('hidden');
    }
  });

  // Ensure settings data is loaded in the new tab
  loadSettingsDataOnce();
})();

// ------------- Init on load -------------

window.addEventListener('DOMContentLoaded', async () => {
  await loadTags();
  renderSentenceTokens(null); // initial empty sentence display
});
