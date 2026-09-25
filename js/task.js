/* =====================================================================
   A small interpreter for the Gorilla Task Builder zone types this study
   uses. Five tasks run through it; none of them is hard-coded.

   A task is {displays: {name: [screen,...]}, rows: [...]}. The runner
   walks the spreadsheet row by row, looks up the display named in the
   row's `display` column, and plays its screens in order. That is
   precisely what Gorilla does, which is why the same code drives the
   keyboard LexEn tasks and the button-based LexTALE without special
   cases.

   Zone types handled:
     content_markdown  content_text  fixation  response_keyboard
     response_keyboard_single  response_button_text  timelimit_screen
     feedback  progress_bar  continue_keyboard  continue_button
     jump_to_row
   ===================================================================== */
"use strict";

function cellValue(spec, row){
  if (!spec) return null;
  return spec.src === "spreadsheet" ? (row[spec.key] ?? "") : spec.key;
}

/* Gorilla substitutes its embedded-data variables into content as
   $${name}. The LexEn tasks use it once, on the end screen, to tell the
   participant their score; without this they would read a literal
   "$${percentage}". */
function substitute(text, vars){
  return String(text).replace(/\$\$\{(\w+)\}/g, (m, name) =>
    (vars && vars[name] !== undefined) ? vars[name] : m);
}

/* Gorilla's fit-text pass: content that would overflow its zone is scaled
   down until it fits, rather than being clipped. Every size inside a zone
   is expressed relative to the inner element (the task's own "150%", our
   em-based headings), so shrinking that one value scales the screen
   proportionally. Without this, raising --type-scale silently cuts the
   top off long screens like the LexEn instructions. */
function fitText(inner, zone){
  const limit = zone.clientHeight;
  if (!limit || inner.scrollHeight <= limit) return;
  const base = parseFloat(getComputedStyle(inner).fontSize);
  let lo = 0.2, hi = 1;
  for (let i = 0; i < 14; i++){
    const mid = (lo + hi) / 2;
    inner.style.fontSize = (base * mid) + "px";
    if (inner.scrollHeight <= limit) lo = mid; else hi = mid;
  }
  inner.style.fontSize = (base * lo) + "px";
}

function zoneEl(z){
  const el = document.createElement("div");
  const box = z.box || {};
  const width = 100 - (box.left || 0) - (box.right || 0);
  el.className = "zone" + (width < 90 ? " tight" : "");
  placeZone(el, box);
  return el;
}

/* Gorilla's randomise_trials column: rows sharing a value are shuffled
   among the positions those rows occupy; blank rows stay where they are.
   In this study it is set only on the 16 practice rows of each LexEn
   task — the test items and LexTALE run in spreadsheet order. The order
   is drawn once, so a practice repeat (jump_to_row) replays the same
   sequence, as Gorilla does. */
function gorillaOrder(rows){
  const order = rows.map((_, i) => i);
  const groups = {};
  rows.forEach((r, i) => {
    const g = String(r.randomise_trials ?? "").trim();
    if (g) (groups[g] = groups[g] || []).push(i);
  });
  for (const pos of Object.values(groups)){
    const picked = pos.slice();
    for (let k = picked.length - 1; k > 0; k--){
      const j = Math.floor(Math.random() * (k + 1));
      [picked[k], picked[j]] = [picked[j], picked[k]];
    }
    pos.forEach((p, k) => { order[p] = picked[k]; });
  }
  return order;
}

async function runTask(task, opts){
  const state = opts.state || { i: 0, practiceCorrect: 0, practiceTotal: 0, vars: {} };
  if (!state.vars) state.vars = {};
  if (!state.order) state.order = gorillaOrder(task.rows);
  const rows = state.order.map(i => task.rows[i]);

  /* Keep the running totals a screen's embedded_data mapping asks for. */
  function accumulate(screen, correct){
    const e = screen && screen.embedded;
    if (!e) return;
    const v = state.vars;
    if (e.total) v[e.total] = (v[e.total] || 0) + 1;
    if (e.correct) v[e.correct] = (v[e.correct] || 0) + correct;
    if (e.percent_correct && e.correct && e.total){
      v[e.percent_correct] = v[e.total]
        ? Math.round(100 * v[e.correct] / v[e.total]) : 0;
    }
  }
  const progressRows = rows.filter(r => r.display === "trial" || r.display === "check").length;
  let progressDone = 0;
  if (state.progressPct === undefined) state.progressPct = 0;

  stageOn(true);

  while (state.i < rows.length){
    const row = rows[state.i];
    const screens = task.displays[row.display];
    if (!screens){ state.i++; continue; }

    let jumped = null;
    let s = 0;
    while (s < screens.length){
      const res = await runScreen(screens[s], row, task, state);
      if (res && res.jump !== undefined){ jumped = res.jump; break; }
      if (res && res.goto){
        const idx = screens.findIndex(x => x.name === res.goto);
        if (idx >= 0){ s = idx; continue; }
      }
      s++;
    }

    if (row.display === "trial" || row.display === "check"){
      progressDone++;
      state.progressPct = progressRows ? (100 * progressDone / progressRows) : 0;
    }

    if (jumped !== null){ state.i = jumped; continue; }
    state.i++;
    if (opts.onTick) opts.onTick(state);
  }

  stageOn(false);
  return state;

  /* ------------------------------------------------------------------ */
  async function runScreen(screen, row, task, state){
    const stage = $frame();
    stage.innerHTML = "";
    const zones = screen.zones || [];

    // Zones that do not themselves wait: paint them first.
    let feedbackZone = null, progressZone = null;
    const painted = [];

    for (const z of zones){
      if (z.type === "content_markdown" || z.type === "content_text"){
        const el = zoneEl(z);
        const inner = document.createElement("div");
        inner.className = "inner";
        const v = cellValue(z.content, row);
        if (z.type === "content_text"){
          el.classList.add("text-zone");
          inner.textContent = substitute(v ?? "", state.vars);
        } else {
          inner.innerHTML = renderContent(substitute(v ?? "", state.vars));
        }
        el.appendChild(inner);
        stage.appendChild(el);
        fitText(inner, el);
        painted.push(el);
      } else if (z.type === "fixation"){
        const el = zoneEl(z);
        el.innerHTML = '<div id="fixation">+</div>';
        stage.appendChild(el);
        painted.push(el);
      } else if (z.type === "feedback"){
        feedbackZone = z;
      } else if (z.type === "progress_bar"){
        progressZone = z;
        if (String(cellValue(z.show, row)) === "1"){
          const el = zoneEl(z);
          const wrap = document.createElement("div");
          wrap.className = "pbar";
          const track = document.createElement("div");
          track.className = "track";
          const fill = document.createElement("div");
          fill.className = "fill" + (z.colour === "green" ? " green" : "");
          fill.style.width = (state.progressPct || 0).toFixed(2) + "%";
          track.appendChild(fill); wrap.appendChild(track);
          el.appendChild(wrap);
          el.setAttribute("role", "progressbar");
          el.setAttribute("aria-valuemin", "0");
          el.setAttribute("aria-valuemax", "100");
          el.setAttribute("aria-valuenow", Math.round(state.progressPct || 0));
          stage.appendChild(el);
          painted.push(el);
        }
      }
    }

    const fix = zones.find(z => z.type === "fixation");
    const kb = zones.find(z => z.type === "response_keyboard" ||
                               z.type === "response_keyboard_single");
    const buttons = zones.filter(z => z.type === "response_button_text");
    const limit = zones.find(z => z.type === "timelimit_screen");
    const cont = zones.find(z => z.type === "continue_keyboard" ||
                                 z.type === "continue_button");
    const jump = zones.find(z => z.type === "jump_to_row");

    /* ---- a fixation screen is simply a timed display ---- */
    if (fix && !kb && !buttons.length && !cont){
      hiddenSeen = document.hidden;
      const actual = await showFor(fix.time, null);
      state.lastFixation = Math.round(actual);
      if (fix.pause) await showFor(fix.pause, () => { stage.innerHTML = ""; });
      return {};
    }

    /* ---- keyboard response ---- */
    if (kb){
      if (!fix) hiddenSeen = document.hidden;
      const keys = kb.keys.map(k => String(k.key).toLowerCase());
      const t = limit && limit.limit ? limit.limit : null;
      const r = await waitKey(keys, t);
      const chosen = r.timedOut ? null : kb.keys.find(k => String(k.key).toLowerCase() === r.key);
      const response = chosen ? chosen.response : "";
      const correctAnswer = cellValue(kb.correct, row);
      const correct = r.timedOut ? 0 : (response === correctAnswer ? 1 : 0);

      if (feedbackZone && feedbackZone.time > 0 &&
          ((correct && feedbackZone.on_correct) || (!correct && feedbackZone.on_incorrect))){
        const el = zoneEl(feedbackZone);
        el.innerHTML = `<div class="fb ${correct ? "good" : "bad"}">${correct ? "Correct" : "Incorrect"}</div>`;
        stage.innerHTML = "";
        stage.appendChild(el);
        await showFor(feedbackZone.time, null);
      }

      accumulate(screen, correct);

      log({
        node: opts.nodeKey, task: task.title, display: row.display,
        spreadsheet_row: state.order[state.i] + 2,
        item: row.item ?? "", answer: correctAnswer ?? "",
        response, key_pressed: r.key || "",
        reaction_time: r.rt === null ? "" : r.rt,
        correct, timed_out: r.timedOut ? 1 : 0,
        item_type: row.type ?? "",
        block: row.BlockNumber ?? "",
        fixation_actual_ms: state.lastFixation ?? "",
        hidden_during_trial: hiddenSeen ? 1 : 0,
      });
      state.lastFixation = undefined;

      if (row.display === "practice"){
        state.practiceTotal++;
        state.practiceCorrect += correct;
      }
      return {};
    }

    /* ---- button responses (LexTALE, and the practice advance/repeat) ---- */
    if (buttons.length){
      hiddenSeen = document.hidden;
      const t0 = performance.now();
      const picked = await new Promise(resolve => {
        buttons.forEach(z => {
          const el = zoneEl(z);
          const b = document.createElement("button");
          b.className = "resp";
          b.textContent = z.label;
          b.onclick = () => resolve(z);
          el.appendChild(b);
          stage.appendChild(el);
        });
      });
      const rt = Math.round(performance.now() - t0);
      const correctAnswer = cellValue(picked.correct, row);
      const isCorrect = picked.label === correctAnswer;
      accumulate(screen, isCorrect ? 1 : 0);

      log({
        node: opts.nodeKey, task: task.title, display: row.display,
        spreadsheet_row: state.order[state.i] + 2,
        item: row.item ?? "", answer: correctAnswer ?? "",
        response: picked.label, key_pressed: "",
        reaction_time: rt, correct: isCorrect ? 1 : 0, timed_out: 0,
        item_type: row.type ?? "", block: row.BlockNumber ?? "",
        fixation_actual_ms: state.lastFixation ?? "",
        hidden_during_trial: hiddenSeen ? 1 : 0,
      });
      state.lastFixation = undefined;

      /* practice_score routes to a named screen depending on the choice */
      if (picked.next_correct || picked.next_incorrect){
        return { goto: isCorrect ? picked.next_correct : picked.next_incorrect };
      }
      return {};
    }

    /* ---- a jump screen rewinds the spreadsheet (practice repeat) ---- */
    if (jump){
      if (limit && limit.limit) await showFor(limit.limit, null);
      state.practiceCorrect = 0; state.practiceTotal = 0;
      return { jump: Math.max(0, jump.index - 1) };
    }

    /* ---- a pure time-limited screen, with optional countdown ---- */
    if (limit && !cont){
      const el = zoneEl(limit);
      const inner = document.createElement("div");
      inner.className = "inner countdown";
      el.appendChild(inner);
      stage.appendChild(el);
      const total = limit.countdown || limit.limit;
      let left = Math.ceil(total / 1000);
      const tick = () => { inner.textContent = left > 0 ? String(left) : ""; };
      tick();
      const iv = setInterval(() => { left--; tick(); }, 1000);
      await showFor(limit.limit, null);
      clearInterval(iv);
      return {};
    }

    /* ---- self-paced screen: space bar, or a Next button ---- */
    if (cont){
      if (cont.type === "continue_keyboard"){
        await waitKey([" "], null);
      } else {
        const el = zoneEl(cont);
        const b = document.createElement("button");
        b.textContent = "Next";
        el.appendChild(b);
        stage.appendChild(el);
        await new Promise(res => { b.onclick = res; b.focus({ preventScroll: true }); });
      }
      return {};
    }

    return {};
  }
}

/* Gorilla's content zones hold HTML inside markdown. Only the small
   markdown subset the study actually uses needs handling: headings. */
function renderContent(s){
  return String(s).replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
}
