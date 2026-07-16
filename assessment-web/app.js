(function () {
  'use strict';

  var API_BASE = window.DAPROVA_API_BASE || 'http://localhost:4001';
  var app = document.getElementById('app');

  function getCohortToken() {
    var parts = location.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1];
  }
  var COHORT_TOKEN = getCohortToken();

  // ---------- localStorage: learner identity persists across visits (FR-M2-06) ----------
  var LEARNER_KEY_PREFIX = 'daprova_learner_';
  function learnerKey() { return LEARNER_KEY_PREFIX + COHORT_TOKEN; }
  function getStoredLearnerToken() {
    var direct = localStorage.getItem(learnerKey());
    if (direct) return direct;
    // Pre and post links use different tokens for the same cohort, so a
    // fresh visit to the post link has nothing stored under this exact key
    // even when this device already completed the pre-assessment (US-08:
    // "post-assessment link recognises learner token from localStorage").
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
        var learnerToken = records[0].learnerToken;
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
    learnerToken: getStoredLearnerToken(),
    sessionType: null,
    questions: [],
    areaOrder: [],
    index: 0,
    confidenceQueue: [],
    confidenceAnswers: {},
    answeredCount: 0,
  };

  function groupByArea(questions) {
    var order = [];
    var seen = {};
    questions.forEach(function (q) {
      if (!seen[q.area_id]) { seen[q.area_id] = true; order.push(q.area_id); }
    });
    return order;
  }

  function render(html) { app.innerHTML = html; }

  // ---------- Screens ----------
  function showError(message) {
    render('<h1>Something went wrong</h1><p class="error">' + message + '</p>');
  }

  function showDemographicsForm() {
    render(
      '<h1>Before you start</h1>' +
      '<p class="subtitle">A few quick details — this helps your program place and track you correctly. Takes 30 seconds.</p>' +
      '<div class="card">' +
      textField('display_name', 'Your full name') +
      textField('enrolment_id', 'Enrolment / student ID') +
      field('gender', 'Gender', [['male', 'Male'], ['female', 'Female'], ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']]) +
      field('age_group', 'Age group', [['15-24', '15–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45+', '45+']]) +
      field('location_type', 'Location', [['urban', 'Urban'], ['rural', 'Rural'], ['peri-urban', 'Peri-urban']]) +
      field('disability', 'Do you have a disability?', [['no', 'No'], ['yes', 'Yes'], ['prefer_not_to_say', 'Prefer not to say']]) +
      '<button class="btn" id="demoStart" disabled>Start assessment</button>' +
      '<p class="error" id="demoError"></p>' +
      '</div>',
    );
    var requiredIds = ['display_name', 'enrolment_id', 'gender', 'age_group', 'location_type', 'disability'];
    var startBtn = document.getElementById('demoStart');
    function checkComplete() {
      startBtn.disabled = requiredIds.some(function (id) { return !document.getElementById(id).value; });
    }
    requiredIds.forEach(function (id) {
      document.getElementById(id).addEventListener('input', checkComplete);
      document.getElementById(id).addEventListener('change', checkComplete);
    });
    startBtn.addEventListener('click', function () {
      var demographics = {
        gender: val('gender'), age_group: val('age_group'), location_type: val('location_type'), disability: val('disability'),
      };
      begin({ demographics: demographics, display_name: val('display_name'), enrolment_id: val('enrolment_id') });
    });
  }
  function textField(name, label) {
    return '<div class="field"><label>' + label + '</label><input type="text" id="' + name + '" required /></div>';
  }
  function field(name, label, options) {
    var opts = options.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
    return '<div class="field"><label>' + label + '</label><select id="' + name + '"><option value="">Select…</option>' + opts + '</select></div>';
  }
  function val(id) { var v = document.getElementById(id).value; return v || undefined; }

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
        state.areaOrder = groupByArea(data.questions);
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
        showError(err.message);
      });
  }

  function currentArea() { return state.questions[state.index].area_id; }
  function isLastInArea(i) {
    return i === state.questions.length - 1 || state.questions[i + 1].area_id !== state.questions[i].area_id;
  }

  function renderQuestion() {
    var q = state.questions[state.index];
    var total = state.questions.length;
    var options = ['a', 'b', 'c', 'd'].map(function (opt) {
      return '<button class="option" data-opt="' + opt + '">' + q['option_' + opt] + '</button>';
    }).join('');
    render(
      '<p class="progress">Question ' + (state.index + 1) + ' of ' + total + '</p>' +
      '<div class="card"><p class="question-text">' + q.question_text + '</p>' + options + '</div>',
    );
    Array.prototype.forEach.call(document.querySelectorAll('.option'), function (btn) {
      btn.addEventListener('click', function () { answerQuestion(q, btn.dataset.opt); });
    });
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
    }).then(afterAssessmentComplete).catch(function (err) { showError(err.message); });
  }

  function showResultScreen() {
    api('/' + COHORT_TOKEN + '/result/' + state.learnerToken).then(afterAssessmentComplete).catch(function (err) { showError(err.message); });
  }

  // Module 5 (S11) — the satisfaction survey only makes sense once a learner
  // has actually experienced the program, so it's appended after the
  // post-assessment (never the pre-assessment) rather than being its own
  // separate link. "Done" is tracked per learner in localStorage (submit or
  // skip both count) purely to avoid re-prompting on every revisit to the
  // post link — the server itself doesn't need to know "skipped" vs
  // "answered", it only ever sees a submission or nothing.
  function satisfactionKey() { return 'daprova_satisfaction_' + state.learnerToken; }
  function satisfactionDone() { return localStorage.getItem(satisfactionKey()) === '1'; }
  function markSatisfactionDone() { localStorage.setItem(satisfactionKey(), '1'); }

  function afterAssessmentComplete(summary) {
    if (summary.session_type === 'post' && !satisfactionDone()) {
      showSatisfactionSurvey(summary);
    } else {
      showScoreSummary(summary);
    }
  }

  var SURVEY_RATING_FIELDS = ['instructor_rating', 'content_relevance', 'delivery_satisfaction', 'nps_score'];

  function ratingField(name, label, max) {
    var buttons = [];
    for (var i = (max === 10 ? 0 : 1); i <= max; i++) {
      buttons.push('<button data-field="' + name + '" data-rating="' + i + '">' + i + '</button>');
    }
    return '<div class="field"><label>' + label + '</label><div class="rating-row' + (max === 10 ? ' nps-row' : '') + '">' + buttons.join('') + '</div></div>';
  }
  function textareaField(name, label) {
    return '<div class="field"><label>' + label + '</label><textarea id="' + name + '" maxlength="300" rows="3"></textarea></div>';
  }

  function showSatisfactionSurvey(summary) {
    render(
      '<h1>Quick feedback</h1>' +
      '<p class="subtitle">Help us improve this program — takes under a minute.</p>' +
      '<div class="card">' +
      ratingField('instructor_rating', 'How would you rate the instructor?', 5) +
      ratingField('content_relevance', 'How relevant was the content to your goals?', 5) +
      ratingField('delivery_satisfaction', 'How satisfied were you with how the program was delivered?', 5) +
      ratingField('nps_score', 'How likely are you to recommend this program to a friend? (0 = not likely, 10 = very likely)', 10) +
      textareaField('open_positive', 'What did you like most? (optional)') +
      textareaField('open_improve', 'What could be improved? (optional)') +
      '<button class="btn" id="surveySubmit" disabled>Submit feedback</button>' +
      '<button class="btn-link" id="surveySkip">Skip for now</button>' +
      '<p class="error" id="surveyError"></p>' +
      '</div>',
    );

    var answers = {};
    var submitBtn = document.getElementById('surveySubmit');
    function checkComplete() {
      submitBtn.disabled = SURVEY_RATING_FIELDS.some(function (f) { return answers[f] === undefined; });
    }
    Array.prototype.forEach.call(document.querySelectorAll('.rating-row button'), function (btn) {
      btn.addEventListener('click', function () {
        var group = btn.parentElement;
        Array.prototype.forEach.call(group.querySelectorAll('button'), function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        answers[btn.dataset.field] = Number(btn.dataset.rating);
        checkComplete();
      });
    });
    submitBtn.addEventListener('click', function () {
      submitBtn.disabled = true;
      var payload = Object.assign({ learner_token: state.learnerToken }, answers);
      var positive = val('open_positive');
      var improve = val('open_improve');
      if (positive) payload.open_positive = positive;
      if (improve) payload.open_improve = improve;
      api('/' + COHORT_TOKEN + '/satisfaction', { method: 'POST', body: JSON.stringify(payload) })
        .then(function () {
          markSatisfactionDone();
          showScoreSummary(summary);
        })
        .catch(function (err) {
          document.getElementById('surveyError').textContent = err.message;
          submitBtn.disabled = false;
        });
    });
    document.getElementById('surveySkip').addEventListener('click', function () {
      markSatisfactionDone();
      showScoreSummary(summary);
    });
  }

  function showScoreSummary(summary) {
    var gainHtml = '';
    if (summary.gain !== null) {
      var cls = summary.gain >= 0 ? 'gain-positive' : 'gain-negative';
      gainHtml = '<div class="score-row"><span>Improvement</span><span class="' + cls + '">' + (summary.gain >= 0 ? '+' : '') + summary.gain + ' pts</span></div>';
    }
    var rows =
      '<div class="score-row"><span>Pre-assessment score</span><span>' + (summary.pre_score !== null ? summary.pre_score + '%' : '—') + '</span></div>' +
      '<div class="score-row"><span>Post-assessment score</span><span>' + (summary.post_score !== null ? summary.post_score + '%' : '—') + '</span></div>' +
      gainHtml;
    var breakdown = summary.competency_breakdown.map(function (area) {
      return '<div class="score-row"><span>' + area.area_name + '</span><span>' +
        (area.pre_pct !== null ? area.pre_pct + '%' : '—') + ' → ' + (area.post_pct !== null ? area.post_pct + '%' : '—') +
        '</span></div>';
    }).join('');
    render(
      '<h1>Your results</h1><p class="subtitle">' + (summary.session_type === 'post' ? 'Great work completing the program!' : 'Thanks for completing the pre-assessment.') + '</p>' +
      '<div class="card">' + rows + '</div>' +
      '<h1 style="margin-top:24px;font-size:1rem;">By competency area</h1>' +
      '<div class="card">' + breakdown + '</div>',
    );
  }

  // ---------- Boot ----------
  if (!COHORT_TOKEN) {
    showError('Invalid assessment link.');
  } else if (state.learnerToken) {
    begin({});
  } else {
    // First visit, no stored learner_token — assume this is a pre-assessment
    // link (post links require the token per FR-M2-07/US-08 and will 400
    // with a clear message otherwise, since post is never a first visit).
    showDemographicsForm();
  }
})();
