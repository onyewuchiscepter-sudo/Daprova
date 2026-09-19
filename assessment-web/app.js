(function () {
  'use strict';

  var API_BASE = window.DAPROVA_API_BASE || 'http://localhost:4001';
  var app = document.getElementById('app');
  var brandEl = document.getElementById('brand');

  // Everything shown here that came from the server (question text, options,
  // org and course names...) is written by an organisation, so it's escaped
  // before it goes anywhere near innerHTML.
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // /assess/:token (pre or post), /satisfaction/:token, /tracer/:token
  var PATH_PARTS = location.pathname.split('/').filter(Boolean);
  var ROUTE = PATH_PARTS[0];
  var COHORT_TOKEN = PATH_PARTS[PATH_PARTS.length - 1];

  // ---------- localStorage: learner identity persists across visits (FR-M2-06) ----------
  var LEARNER_KEY_PREFIX = 'daprova_learner_';
  function learnerKey() { return LEARNER_KEY_PREFIX + COHORT_TOKEN; }
  function getStoredLearnerToken() {
    var direct = localStorage.getItem(learnerKey());
    if (direct) return direct;
    // Pre and post links use different tokens for the same cohort, so a
    // fresh visit to the post link has nothing stored under this exact key
    // even when this device already completed the pre-assessment (US-08).
    // Fall back to any other learner token on this device and let the
    // server confirm whether it actually belongs to this cohort.
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LEARNER_KEY_PREFIX) === 0 && k !== learnerKey()) {
        return localStorage.getItem(k);
      }
    }
    return null;
  }
  function storeLearnerToken(token) { localStorage.setItem(learnerKey(), token); }
  // Shared phones are common in training centres: let the next person start
  // as themselves instead of inheriting the previous learner's session.
  function forgetLearner() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(LEARNER_KEY_PREFIX) === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    state.learnerToken = null;
  }

  // A personal link from a reminder (?l=<learner_token>) identifies the
  // learner on any device. Stored, then removed from the address bar so it
  // isn't left in a screenshot or shared by accident.
  (function adoptPersonalLink() {
    var params = new URLSearchParams(location.search);
    var personal = params.get('l');
    if (!personal || !/^[0-9a-f-]{36}$/i.test(personal)) return;
    localStorage.setItem(LEARNER_KEY_PREFIX + COHORT_TOKEN, personal);
    params.delete('l');
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  })();

  // ---------- IndexedDB: response queue survives reloads/crashes/offline drops (FR-M2-09, FR-M2-13) ----------
  var DB_NAME = 'daprova-assess';
  var STORE = 'pending_responses';
  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function queueResponse(learnerToken, questionId, selectedOption) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add({ cohortToken: COHORT_TOKEN, learnerToken: learnerToken, questionId: questionId, selectedOption: selectedOption });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function getQueuedForThisCohort() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () {
          resolve(req.result.filter(function (r) { return r.cohortToken === COHORT_TOKEN; }));
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function deleteQueued(ids) {
    if (ids.length === 0) return Promise.resolve();
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        ids.forEach(function (id) { store.delete(id); });
        tx.oncomplete = resolve;
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // Batches queued answers into one request instead of one POST per question —
  // fewer radio wake-ups on 3G. Safe to call repeatedly; anything that fails
  // to send just stays queued for the next attempt (offline-first).
  //
  // Calls are serialized through a chained promise rather than a simple
  // "already running, skip" boolean guard: a boolean guard would make an
  // overlapping call no-op and resolve immediately, so a caller like
  // finishAssessment() that awaits flushQueue() before submitting could
  // proceed while answers queued moments earlier were still unsent — real
  // data loss under the exact rapid-answering pattern this queue exists to
  // protect against. Chaining guarantees every call's returned promise only
  // resolves once a flush attempt that started at-or-after that call has
  // finished, and that attempt re-reads the queue fresh so nothing is missed.
  var flushChain = Promise.resolve();
  function flushQueue() {
    flushChain = flushChain.then(doFlushOnce, doFlushOnce);
    return flushChain;
  }
  function doFlushOnce() {
    return getQueuedForThisCohort()
      .then(function (records) {
        if (records.length === 0) return;
        // One learner per batch: on a shared phone the queue can hold two
        // people's answers, which must never be sent under one token.
        var learnerToken = records[0].learnerToken;
        records = records.filter(function (r) { return r.learnerToken === learnerToken; });
        var responses = records.map(function (r) { return { question_id: r.questionId, selected_option: r.selectedOption }; });
        return fetch(API_BASE + '/api/v1/assess/' + COHORT_TOKEN + '/response', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ learner_token: learnerToken, responses: responses }),
        }).then(function (res) {
          if (!res.ok) throw new Error('flush failed');
          return deleteQueued(records.map(function (r) { return r.id; }));
        });
      })
      .then(function () { setOfflineBanner(false); })
      .catch(function () { setOfflineBanner(true); });
  }

  window.addEventListener('online', flushQueue);
  setInterval(flushQueue, 8000);

  var offlineBannerEl = null;
  function setOfflineBanner(show) {
    if (show && !offlineBannerEl) {
      offlineBannerEl = document.createElement('div');
      offlineBannerEl.className = 'offline-banner';
      offlineBannerEl.textContent = "Saved on this device — we'll sync it once you're back online.";
      app.insertBefore(offlineBannerEl, app.firstChild);
    } else if (!show && offlineBannerEl) {
      offlineBannerEl.remove();
      offlineBannerEl = null;
    }
  }

  // ---------- API helpers ----------
  function api(path, opts) {
    return fetch(API_BASE + '/api/v1/assess' + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) { var e = new Error(body.error ? body.error.message : 'Request failed'); e.status = res.status; e.body = body; throw e; }
        return body;
      });
    });
  }

  // ---------- State ----------
  var state = {
    info: null,
    learnerToken: getStoredLearnerToken(),
    sessionType: null,
    questions: [],
    index: 0,
    confidenceAnswers: {},
    answeredCount: 0,
  };

  function render(html) { app.innerHTML = html; }

  // ---------- Programme header + branding ----------
  // Cohorts on the Growth plan and above show the org's own logo and colour.
  function applyBranding(info) {
    var b = info.branding || {};
    if (b.custom && b.color) {
      document.documentElement.style.setProperty('--gain', b.color);
      document.documentElement.style.setProperty('--gain-deep', b.color);
    }
    var logo = b.custom && b.logo_url
      ? '<img class="brand-logo" src="' + esc(API_BASE + b.logo_url) + '" alt="' + esc(info.org_name) + '" />'
      : '<img class="brand-mark" src="/daprova-mark.svg" alt="" />';
    brandEl.innerHTML =
      logo +
      '<div class="brand-text"><span class="brand-org">' + esc(info.org_name) + '</span>' +
      '<span class="brand-course">' + esc(info.course_name) + '</span></div>';
    brandEl.hidden = false;
    document.title = info.course_name + ' · ' + info.org_name;
  }

  // ---------- Screens ----------
  function showError(message) {
    render('<h1>Something went wrong</h1><p class="error">' + esc(message) + '</p>');
  }

  function notYouLink() {
    return '<button class="btn-link" id="notYou">Not you? Start as a new learner</button>';
  }
  function wireNotYou(next) {
    var btn = document.getElementById('notYou');
    if (btn) btn.addEventListener('click', function () { forgetLearner(); next(); });
  }

  function showDemographicsForm() {
    render(
      '<h1>Before you start</h1>' +
      '<p class="subtitle">A few quick details — this helps your programme place and track you correctly. Takes 30 seconds.</p>' +
      '<div class="card">' +
      textField('display_name', 'Your full name') +
      textField('enrolment_id', 'Enrolment / student ID') +
      field('gender', 'Gender', [['male', 'Male'], ['female', 'Female'], ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']]) +
      field('age_group', 'Age group', [['15-24', '15–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45+', '45+']]) +
      field('location_type', 'Location', [['urban', 'Urban'], ['rural', 'Rural'], ['peri-urban', 'Peri-urban']]) +
      field('disability', 'Do you have a disability?', [['no', 'No'], ['yes', 'Yes'], ['prefer_not_to_say', 'Prefer not to say']]) +
      '<fieldset class="contact"><legend>Stay in touch <span class="optional">(optional)</span></legend>' +
      '<div class="field"><label for="email">Email</label><input type="email" id="email" autocomplete="email" inputmode="email" /></div>' +
      '<div class="field"><label for="phone">Phone / WhatsApp</label><input type="tel" id="phone" autocomplete="tel" inputmode="tel" placeholder="0803 123 4567" /></div>' +
      '<label class="check"><input type="checkbox" id="contact_consent" /> <span>' + esc(state.info.org_name) +
      ' may contact me about this programme — reminders to finish my assessment, and my certificate.</span></label>' +
      '</fieldset>' +
      '<button class="btn" id="demoStart" disabled>Start assessment</button>' +
      '<p class="error" id="demoError"></p>' +
      '</div>',
    );
    var requiredIds = ['display_name', 'enrolment_id', 'gender', 'age_group', 'location_type', 'disability'];
    var startBtn = document.getElementById('demoStart');
    var errorEl = document.getElementById('demoError');
    function checkComplete() {
      startBtn.disabled = requiredIds.some(function (id) { return !document.getElementById(id).value; });
    }
    requiredIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', checkComplete);
      document.getElementById(id).addEventListener('change', checkComplete);
    });
    startBtn.addEventListener('click', function () {
      var email = val('email');
      var phone = val('phone');
      var consent = document.getElementById('contact_consent').checked;
      if ((email || phone) && !consent) {
        errorEl.textContent = 'Tick the box to let your programme contact you, or leave email and phone empty.';
        return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorEl.textContent = 'That email address doesn’t look right.';
        return;
      }
      var payload = {
        demographics: { gender: val('gender'), age_group: val('age_group'), location_type: val('location_type'), disability: val('disability') },
        display_name: val('display_name'),
        enrolment_id: val('enrolment_id'),
      };
      if (consent && (email || phone)) {
        payload.contact_consent = true;
        if (email) payload.email = email;
        if (phone) payload.phone = phone;
      }
      begin(payload);
    });
  }
  function textField(name, label) {
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label><input type="text" id="' + name + '" required /></div>';
  }
  function field(name, label, options) {
    var opts = options.map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>'; }).join('');
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label><select id="' + name + '"><option value="">Select…</option>' + opts + '</select></div>';
  }
  function val(id) { var el = document.getElementById(id); var v = el && el.value ? el.value.trim() : ''; return v || undefined; }

  function begin(startOpts) {
    render('<p>Loading assessment…</p>');
    var payload = Object.assign({}, startOpts);
    if (state.learnerToken) payload.learner_token = state.learnerToken;
    api('/' + COHORT_TOKEN + '/start', { method: 'POST', body: JSON.stringify(payload) })
      .then(function (data) {
        state.learnerToken = data.learner_token;
        storeLearnerToken(data.learner_token);
        state.sessionType = data.session_type;
        state.questions = data.questions;
        state.index = 0;
        state.confidenceAnswers = {};
        state.answeredCount = 0;
        if (state.questions.length === 0) {
          showError('No questions are available for this assessment yet.');
          return;
        }
        renderQuestion();
      })
      .catch(function (err) {
        if (err.status === 409) {
          showResultScreen();
          return;
        }
        // A stored identity that doesn't belong to this cohort (e.g. a shared
        // phone used for a different programme): start fresh on a pre link.
        if (state.info.kind === 'pre' && startOpts && !startOpts.display_name && (err.status === 404 || err.status === 400)) {
          forgetLearner();
          showDemographicsForm();
          return;
        }
        render('<h1>We couldn’t start your assessment</h1><p class="error">' + esc(err.message) + '</p>');
      });
  }

  function isLastInArea(i) {
    return i === state.questions.length - 1 || state.questions[i + 1].area_id !== state.questions[i].area_id;
  }

  // Four question types: multiple choice, scenario (a situation to read,
  // then multiple choice), true/false, and self-rating (1-5, not scored).
  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;
    var type = q.question_type || 'mcq';
    var body;
    if (type === 'self_rating') {
      var scale = [1, 2, 3, 4, 5].map(function (n) { return '<button data-opt="' + n + '" aria-label="' + n + ' of 5">' + n + '</button>'; }).join('');
      body =
        '<p class="question-text">' + esc(q.question_text) + '</p>' +
        '<div class="rating-row answer-row">' + scale + '</div>' +
        '<div class="scale-labels"><span>1 = ' + esc(q.option_a || 'Not confident') + '</span><span>5 = ' + esc(q.option_b || 'Very confident') + '</span></div>';
    } else {
      var letters = type === 'true_false' ? ['a', 'b'] : ['a', 'b', 'c', 'd'];
      var options = letters.map(function (opt) {
        return '<button class="option" data-opt="' + opt + '">' + esc(q['option_' + opt]) + '</button>';
      }).join('');
      body =
        (type === 'scenario' && q.scenario_text ? '<div class="scenario"><span class="scenario-label">Scenario</span>' + esc(q.scenario_text) + '</div>' : '') +
        '<p class="question-text">' + esc(q.question_text) + '</p>' + options;
    }
    render(
      '<p class="progress">Question ' + (state.index + 1) + ' of ' + total + '</p>' +
      '<div class="card">' + body + '</div>' +
      (state.index === 0 ? notYouLink() : ''),
    );
    Array.prototype.forEach.call(document.querySelectorAll('[data-opt]'), function (btn) {
      btn.addEventListener('click', function () { answerQuestion(q, btn.dataset.opt); });
    });
    wireNotYou(function () { state.info.kind === 'pre' ? showDemographicsForm() : bootAssessment(); });
  }

  function answerQuestion(question, selectedOption) {
    queueResponse(state.learnerToken, question.id, selectedOption);
    state.answeredCount++;
    if (state.answeredCount % 4 === 0) flushQueue();

    if (isLastInArea(state.index)) {
      renderConfidence(question.area_id);
    } else {
      state.index++;
      renderQuestion();
    }
  }

  function renderConfidence(areaId) {
    var buttons = [1, 2, 3, 4, 5].map(function (n) {
      return '<button data-rating="' + n + '">' + n + '</button>';
    }).join('');
    render(
      '<div class="card">' +
      '<p class="question-text">How confident do you feel in this skill area?</p>' +
      '<div class="rating-row">' + buttons + '</div>' +
      '<p class="subtitle">1 = not at all confident, 5 = very confident</p>' +
      '</div>',
    );
    Array.prototype.forEach.call(document.querySelectorAll('.rating-row button'), function (btn) {
      btn.addEventListener('click', function () {
        state.confidenceAnswers[areaId] = Number(btn.dataset.rating);
        if (state.index === state.questions.length - 1) {
          finishAssessment();
        } else {
          state.index++;
          renderQuestion();
        }
      });
    });
  }

  function finishAssessment() {
    render('<p>Submitting your answers…</p>');
    flushQueue().then(function () {
      var confidence = Object.keys(state.confidenceAnswers).map(function (areaId) {
        return { area_id: areaId, rating: state.confidenceAnswers[areaId] };
      });
      return api('/' + COHORT_TOKEN + '/submit', {
        method: 'POST',
        body: JSON.stringify({ learner_token: state.learnerToken, confidence: confidence }),
      });
    }).then(showScoreSummary).catch(function (err) { showError(err.message); });
  }

  function showResultScreen() {
    api('/' + COHORT_TOKEN + '/result/' + state.learnerToken).then(showScoreSummary).catch(function (err) { showError(err.message); });
  }

  function showScoreSummary(summary) {
    var gainHtml = '';
    if (summary.gain !== null) {
      var cls = summary.gain >= 0 ? 'gain-positive' : 'gain-negative';
      gainHtml = '<div class="score-row"><span>Improvement</span><span class="' + cls + '">' + (summary.gain >= 0 ? '+' : '') + esc(summary.gain) + ' pts</span></div>';
    }
    var rows =
      '<div class="score-row"><span>Pre-assessment score</span><span>' + (summary.pre_score !== null ? esc(summary.pre_score) + '%' : '—') + '</span></div>' +
      '<div class="score-row"><span>Post-assessment score</span><span>' + (summary.post_score !== null ? esc(summary.post_score) + '%' : '—') + '</span></div>' +
      gainHtml;
    var breakdown = summary.competency_breakdown.map(function (area) {
      return '<div class="score-row"><span>' + esc(area.area_name) + '</span><span>' +
        (area.pre_pct !== null ? esc(area.pre_pct) + '%' : '—') + ' → ' + (area.post_pct !== null ? esc(area.post_pct) + '%' : '—') +
        '</span></div>';
    }).join('');
    // Certificate once the post-assessment is in.
    var certificate = summary.post_score !== null
      ? '<a class="btn btn-certificate" href="' + esc(API_BASE + '/api/v1/assess/' + COHORT_TOKEN + '/certificate/' + state.learnerToken) + '">Download your certificate (PDF)</a>'
      : '';
    render(
      '<h1>Your results</h1><p class="subtitle">' + (summary.session_type === 'post' ? 'Great work completing the programme!' : 'Thanks for completing the pre-assessment. You’ll take a similar one at the end to see how much you’ve learned.') + '</p>' +
      '<div class="card">' + rows + '</div>' +
      certificate +
      '<h1 style="margin-top:24px;font-size:1rem;">By competency area</h1>' +
      '<div class="card">' + breakdown + '</div>' +
      notYouLink(),
    );
    wireNotYou(function () { state.info.kind === 'pre' ? showDemographicsForm() : bootAssessment(); });
  }

  // ---------- Identify by enrolment ID (satisfaction + tracer links on a new device) ----------
  function showEnrolmentIdentifyForm(title, identifyPath, next) {
    render(
      '<h1>' + esc(title) + '</h1>' +
      '<p class="subtitle">Enter your enrolment / student ID to continue.</p>' +
      '<div class="card">' +
      textField('enrolment_id', 'Enrolment / student ID') +
      '<button class="btn" id="identifyBtn" disabled>Continue</button>' +
      '<p class="error" id="identifyError"></p>' +
      '</div>',
    );
    var input = document.getElementById('enrolment_id');
    var btn = document.getElementById('identifyBtn');
    input.addEventListener('input', function () { btn.disabled = !input.value; });
    btn.addEventListener('click', function () {
      btn.disabled = true;
      api('/' + COHORT_TOKEN + identifyPath, { method: 'POST', body: JSON.stringify({ enrolment_id: input.value.trim() }) })
        .then(function (data) {
          state.learnerToken = data.learner_token;
          storeLearnerToken(data.learner_token);
          next();
        })
        .catch(function (err) {
          document.getElementById('identifyError').textContent = err.message;
          btn.disabled = false;
        });
    });
  }

  function choiceButtons(name, options) {
    return '<div class="choice-list" data-field="' + name + '">' + options.map(function (o) {
      return '<button class="option" data-field="' + name + '" data-value="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function ratingField(name, label, max) {
    var buttons = [];
    for (var i = (max === 10 ? 0 : 1); i <= max; i++) {
      buttons.push('<button data-field="' + name + '" data-value="' + i + '">' + i + '</button>');
    }
    return '<div class="field"><label>' + esc(label) + '</label><div class="rating-row' + (max === 10 ? ' nps-row' : '') + '">' + buttons.join('') + '</div></div>';
  }
  function textareaField(name, label, max) {
    return '<div class="field"><label for="' + name + '">' + esc(label) + '</label><textarea id="' + name + '" maxlength="' + (max || 300) + '" rows="3"></textarea></div>';
  }
  // Wires every [data-field][data-value] button into `answers`, one choice per field.
  function wireChoices(answers, onChange) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-field][data-value]'), function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.dataset.field;
        Array.prototype.forEach.call(document.querySelectorAll('[data-field="' + field + '"][data-value]'), function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        answers[field] = btn.dataset.value;
        onChange();
      });
    });
  }

  // ---------- Module 5: satisfaction survey ----------
  var SURVEY_RATING_FIELDS = ['instructor_rating', 'content_relevance', 'delivery_satisfaction', 'nps_score'];

  function showSatisfactionSurvey() {
    render(
      '<h1>Quick feedback</h1>' +
      '<p class="subtitle">Help us improve this programme — takes under a minute.</p>' +
      '<div class="card">' +
      ratingField('instructor_rating', 'How would you rate the instructor?', 5) +
      ratingField('content_relevance', 'How relevant was the content to your goals?', 5) +
      ratingField('delivery_satisfaction', 'How satisfied were you with how the programme was delivered?', 5) +
      ratingField('nps_score', 'How likely are you to recommend this programme to a friend? (0 = not likely, 10 = very likely)', 10) +
      textareaField('open_positive', 'What did you like most? (optional)') +
      textareaField('open_improve', 'What could be improved? (optional)') +
      '<button class="btn" id="surveySubmit" disabled>Submit feedback</button>' +
      '<p class="error" id="surveyError"></p>' +
      '</div>',
    );
    var answers = {};
    var submitBtn = document.getElementById('surveySubmit');
    wireChoices(answers, function () {
      submitBtn.disabled = SURVEY_RATING_FIELDS.some(function (f) { return answers[f] === undefined; });
    });
    submitBtn.addEventListener('click', function () {
      submitBtn.disabled = true;
      var payload = { learner_token: state.learnerToken };
      SURVEY_RATING_FIELDS.forEach(function (f) { payload[f] = Number(answers[f]); });
      var positive = val('open_positive');
      var improve = val('open_improve');
      if (positive) payload.open_positive = positive;
      if (improve) payload.open_improve = improve;
      api('/' + COHORT_TOKEN + '/satisfaction', { method: 'POST', body: JSON.stringify(payload) })
        .then(function () { render('<h1>Thank you!</h1><p class="subtitle">Your feedback has been recorded — thanks for helping us improve the programme.</p>'); })
        .catch(function (err) {
          // Stored identity from someone else / another programme on this device.
          if (err.status === 404) { forgetLearner(); showEnrolmentIdentifyForm('Share your feedback', '/satisfaction/identify', showSatisfactionSurvey); return; }
          document.getElementById('surveyError').textContent = err.message;
          submitBtn.disabled = false;
        });
    });
  }

  // ---------- Module 6: tracer (follow-up) survey ----------
  var TRACER_FIELDS = ['employment_status', 'business_status', 'income_change', 'skill_usage', 'training_contribution'];

  function showTracerSurvey() {
    render(
      '<h1>What’s changed since the programme?</h1>' +
      '<p class="subtitle">Five quick questions — your answers help ' + esc(state.info.org_name) + ' and its funders understand what training really leads to.</p>' +
      '<div class="card">' +
      '<div class="field"><label>What best describes your work now?</label>' + choiceButtons('employment_status', [
        ['employed_new', 'I got a new job or promotion'],
        ['employed_same', 'Same job as before'],
        ['self_employed', 'I work for myself'],
        ['studying', 'I’m studying'],
        ['seeking', 'Looking for work'],
        ['not_seeking', 'Not looking for work'],
      ]) + '</div>' +
      '<div class="field"><label>Your own business</label>' + choiceButtons('business_status', [
        ['started', 'I started a business'],
        ['grew', 'My business grew'],
        ['same', 'I have a business — about the same'],
        ['none', 'I don’t run a business'],
      ]) + '</div>' +
      '<div class="field"><label>Compared with before the programme, your income has…</label>' + choiceButtons('income_change', [
        ['increased_a_lot', 'Increased a lot'],
        ['increased', 'Increased'],
        ['same', 'Stayed about the same'],
        ['decreased', 'Decreased'],
        ['prefer_not_to_say', 'Prefer not to say'],
      ]) + '</div>' +
      '<div class="field"><label>How often do you use what you learned?</label>' + choiceButtons('skill_usage', [
        ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['rarely', 'Rarely'], ['never', 'Never'],
      ]) + '</div>' +
      ratingField('training_contribution', 'How much did the programme contribute to these changes? (1 = not at all, 5 = a lot)', 5) +
      textareaField('open_challenge', 'Anything you’d like to share — a win, or what’s still hard? (optional)', 500) +
      '<button class="btn" id="tracerSubmit" disabled>Submit</button>' +
      '<p class="error" id="tracerError"></p>' +
      '</div>',
    );
    var answers = {};
    var submitBtn = document.getElementById('tracerSubmit');
    wireChoices(answers, function () {
      submitBtn.disabled = TRACER_FIELDS.some(function (f) { return answers[f] === undefined; });
    });
    submitBtn.addEventListener('click', function () {
      submitBtn.disabled = true;
      var payload = {
        learner_token: state.learnerToken,
        employment_status: answers.employment_status,
        business_status: answers.business_status,
        income_change: answers.income_change,
        skill_usage: answers.skill_usage,
        training_contribution: Number(answers.training_contribution),
      };
      var story = val('open_challenge');
      if (story) payload.open_challenge = story;
      api('/' + COHORT_TOKEN + '/tracer', { method: 'POST', body: JSON.stringify(payload) })
        .then(function () { render('<h1>Thank you!</h1><p class="subtitle">Your answers have been recorded. Best of luck with what’s next.</p>'); })
        .catch(function (err) {
          if (err.status === 404) { forgetLearner(); showEnrolmentIdentifyForm('A quick follow-up', '/tracer/identify', showTracerSurvey); return; }
          document.getElementById('tracerError').textContent = err.message;
          submitBtn.disabled = false;
        });
    });
  }

  // ---------- Boot ----------
  function bootAssessment() {
    if (state.learnerToken) {
      begin({});
    } else if (state.info.kind === 'pre') {
      showDemographicsForm();
    } else {
      // A post link opened on a device with no record of this learner.
      render(
        '<h1>Final assessment</h1>' +
        '<p class="subtitle">We couldn’t find your earlier assessment on this device. Open the personal link from your reminder message (email, SMS or WhatsApp), or use the same phone or computer you used the first time.</p>',
      );
    }
  }

  function boot() {
    if (!COHORT_TOKEN || ['assess', 'satisfaction', 'tracer'].indexOf(ROUTE) === -1) {
      showError('This link is not complete. Please use the full link your programme sent you.');
      return;
    }
    render('<p>Loading…</p>');
    api('/' + COHORT_TOKEN + '/info')
      .then(function (info) {
        state.info = info;
        applyBranding(info);
        if (info.kind === 'satisfaction') {
          state.learnerToken ? showSatisfactionSurvey() : showEnrolmentIdentifyForm('Share your feedback', '/satisfaction/identify', showSatisfactionSurvey);
        } else if (info.kind === 'tracer') {
          state.learnerToken ? showTracerSurvey() : showEnrolmentIdentifyForm('A quick follow-up', '/tracer/identify', showTracerSurvey);
        } else {
          bootAssessment();
        }
      })
      .catch(function (err) { showError(err.message); });
  }

  boot();
})();
