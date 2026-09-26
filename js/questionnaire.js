/* =====================================================================
   Questionnaire renderer.

   Gorilla has two questionnaire editors and this study uses both, so the
   generator flattens each into the same shape: pages of items, each item
   one of text / consent / radio / choice / grid / text_entry / comment /
   slider. One renderer covers both.

   Required questions are enforced the way Gorilla does it: the page will
   not advance and the first unanswered question is named.
   ===================================================================== */
"use strict";

function renderQuestionnaire(q, opts){
  return new Promise(resolve => {
    const answers = {};
    let page = 0;

    function draw(){
      const col = document.createElement("div");
      col.className = "col";
      const items = q.pages[page];

      items.forEach((it, idx) => {
        const id = `q${page}_${idx}`;
        if (it.kind === "text"){
          const d = document.createElement("div");
          d.innerHTML = renderContent(it.html);
          col.appendChild(d);
          return;
        }

        const wrap = document.createElement("fieldset");
        wrap.className = "q";
        wrap.style.border = "0";
        wrap.style.margin = "0 0 28px";
        wrap.style.padding = "0 0 22px";

        const lab = document.createElement("legend");
        lab.className = "label";
        lab.style.padding = "0";
        lab.innerHTML = renderContent(it.label || "")
          + (it.optional || it.required === false ? "" : ' <span class="req">*</span>');
        wrap.appendChild(lab);

        const required = it.kind === "consent" ? true
                       : it.required !== undefined ? it.required
                       : !it.optional;

        if (it.kind === "consent"){
          const l = document.createElement("label");
          l.className = "opt";
          const cb = document.createElement("input");
          cb.type = "checkbox"; cb.id = id;
          cb.onchange = () => { answers[id] = cb.checked ? "agreed" : ""; };
          l.append(cb, document.createTextNode(" "));
          const sp = document.createElement("span");
          sp.innerHTML = renderContent(it.label || "");
          l.appendChild(sp);
          lab.innerHTML = "&nbsp;";
          wrap.appendChild(l);
        } else if (it.kind === "radio" || it.kind === "choice"){
          const box = document.createElement("div");
          box.className = "opts";
          /* `multiple`: tick boxes, recorded as the ticked options joined
             by "; " in the order shown. */
          const picked = new Set();
          (it.options || []).forEach((o, oi) => {
            const l = document.createElement("label");
            l.className = "opt";
            const r = document.createElement("input");
            r.type = it.multiple ? "checkbox" : "radio"; r.name = id; r.value = o;
            r.onchange = it.multiple
              ? () => { r.checked ? picked.add(o) : picked.delete(o);
                        answers[id] = (it.options || []).filter(x => picked.has(x)).join("; "); }
              : () => { answers[id] = o; };
            l.append(r, document.createTextNode(" "));
            const sp = document.createElement("span");
            /* display_options: corrected text on screen, original value in the data. */
            sp.innerHTML = renderContent(String(it.display_options ? it.display_options[oi] : o));
            l.appendChild(sp);
            box.appendChild(l);
          });
          wrap.appendChild(box);
        } else if (it.kind === "grid"){
          const t = document.createElement("table");
          t.className = "grid";
          const thead = document.createElement("thead");
          const hr = document.createElement("tr");
          hr.appendChild(document.createElement("th"));
          (it.columns || []).forEach(c => {
            const th = document.createElement("th");
            th.innerHTML = renderContent(String(c));
            hr.appendChild(th);
          });
          thead.appendChild(hr); t.appendChild(thead);
          const tb = document.createElement("tbody");
          (it.rows || []).forEach((rw, ri) => {
            const tr = document.createElement("tr");
            const th = document.createElement("th");
            th.scope = "row";
            th.innerHTML = renderContent(String(rw));
            tr.appendChild(th);
            (it.columns || []).forEach(c => {
              const td = document.createElement("td");
              const r = document.createElement("input");
              r.type = "radio"; r.name = `${id}_${ri}`; r.value = c;
              r.setAttribute("aria-label", `${rw}: ${c}`);
              r.onchange = () => { answers[`${id}_${ri}`] = c; };
              td.appendChild(r); tr.appendChild(td);
            });
            tb.appendChild(tr);
          });
          t.appendChild(tb); wrap.appendChild(t);
        } else if (it.kind === "text_entry"){
          const inp = document.createElement("input");
          inp.type = "text"; inp.id = id;
          inp.oninput = () => { answers[id] = inp.value; };
          wrap.appendChild(inp);
        } else if (it.kind === "comment"){
          const ta = document.createElement("textarea");
          ta.rows = it.rows || 5; ta.id = id;
          ta.oninput = () => { answers[id] = ta.value; };
          wrap.appendChild(ta);
        } else if (it.kind === "slider"){
          const row = document.createElement("div");
          row.className = "slider";
          const left = document.createElement("span");
          left.className = "end"; left.textContent = it.label_left || "";
          const inp = document.createElement("input");
          inp.type = "range"; inp.id = id;
          inp.min = it.min ?? 0; inp.max = it.max ?? 100; inp.step = it.step ?? 1;
          inp.value = it.min ?? 0;
          const right = document.createElement("span");
          right.className = "end"; right.textContent = it.label_right || "";
          const out = document.createElement("output");
          out.className = "val";
          const sync = () => { out.textContent = inp.value; answers[id] = inp.value; };
          inp.oninput = sync;
          /* A slider always shows a value, so it is answered from the start —
             blocking on "has the participant touched it" would trap anyone
             whose honest answer is the left-hand end. The recorded value is
             always exactly what is on screen. */
          sync();
          row.append(left, inp, right);
          wrap.appendChild(row);
          if (it.show_value) wrap.appendChild(out);
        }

        wrap.dataset.required = required ? "1" : "";
        wrap.dataset.qid = id;
        wrap.dataset.label = (it.label || "").replace(/<[^>]+>/g, "").trim().slice(0, 80);
        wrap.dataset.kind = it.kind;
        wrap.dataset.gridRows = it.kind === "grid" ? (it.rows || []).length : 0;
        col.appendChild(wrap);
      });

      const actions = document.createElement("div");
      actions.className = "actions";
      let submitted = false;
      const next = document.createElement("button");
      next.textContent = page === q.pages.length - 1 ? "Next" : "Next";
      actions.appendChild(next);
      col.appendChild(actions);

      const err = document.createElement("p");
      err.className = "err";
      err.style.display = "none";
      col.appendChild(err);

      next.onclick = () => {
        const missing = [...col.querySelectorAll('.q[data-required="1"]')].filter(w => {
          const id = w.dataset.qid;
          if (w.dataset.kind === "grid"){
            const n = +w.dataset.gridRows;
            for (let i = 0; i < n; i++) if (!answers[`${id}_${i}`]) return true;
            return false;
          }
          return !answers[id];
        });
        if (missing.length){
          err.style.display = "";
          err.textContent = "Please answer: " + (missing[0].dataset.label || "this question");
          missing[0].scrollIntoView({ block: "center" });
          return;
        }
        /* A page is recorded exactly once. After the last page the screen
           stays up while the next task downloads, and on a real connection
           that takes long enough for a second click — which used to log the
           whole page again. Found by a pilot on the live site: localhost
           answers too fast for it to show. */
        if (submitted) return;
        submitted = true;
        next.disabled = true;
        recordPage(items, page, answers);
        if (page < q.pages.length - 1){
          page++;
          paint();
        } else {
          next.textContent = "Loading…";
          resolve(answers);
        }
      };

      return col;
    }

    function paint(){
      const p = $page();
      p.innerHTML = "";
      p.appendChild(draw());
      stageOn(false);
      scrollTo(0, 0);
      const b = p.querySelector("button");
      if (b) b.focus({ preventScroll: true });
    }

    function recordPage(items, pageIdx, answers){
      /* A page with nothing to answer — an information sheet, or one of the
         "task N of 5" interstitials — still produced a row in Gorilla, so
         every node in the flow shows up in the data. */
      if (!items.some(it => it.kind !== "text")){
        log({ node: opts.nodeKey, task: q.title, display: "viewed",
              page: pageIdx + 1, question: "", sub_question: "", response: "" });
        return;
      }
      items.forEach((it, idx) => {
        if (it.kind === "text") return;
        const id = `q${pageIdx}_${idx}`;
        /* The data keep a question's original wording (log_label) when the
           on-screen wording was corrected, so rows stay comparable. */
        const label = (it.log_label || it.label || "").replace(/<[^>]+>/g, "").trim();
        if (it.kind === "grid"){
          (it.rows || []).forEach((rw, ri) => {
            log({ node: opts.nodeKey, task: q.title, display: "question",
                  page: pageIdx + 1, question: label,
                  sub_question: String(rw).replace(/<[^>]+>/g, "").trim(),
                  response: answers[`${id}_${ri}`] ?? "" });
          });
        } else {
          const v = answers[id] ?? "";
          log({ node: opts.nodeKey, task: q.title, display: "question",
                page: pageIdx + 1, question: label, sub_question: "", response: v });
          /* Handedness writes a participant property the branch reads. */
          if (it.write && it.key) PARTICIPANT[it.key] = v;
        }
      });
    }

    paint();
  });
}

const PARTICIPANT = {};
