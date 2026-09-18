// components/CardForm.js — the ONE card form (Add + Edit share it) and the ONE
// validation function (spec §6). Also owns the single save path used everywhere.
window.CV = window.CV || {};

// ---- validation (spec §6: required = ownerId, both photos, player, sport,
//      graded, and grading.company + grading.grade when graded) --------------
CV.validateCard = function (form, photos) {
  const e = {};
  if (!photos.front || (!photos.front.previewUrl && !photos.front.url)) e.front = "Front photo required";
  if (!photos.back || (!photos.back.previewUrl && !photos.back.url)) e.back = "Back photo required";
  if (!form.player || !form.player.trim()) e.player = "Player is required";
  if (!form.sport) e.sport = "Sport is required";
  if (form.year && (isNaN(Number(form.year)) || Number(form.year) < 1860 || Number(form.year) > 2100))
    e.year = "Enter a valid year";
  if (form.graded) {
    if (!form.grading || !form.grading.company) e.gradingCompany = "Grading company required";
    if (!form.grading || form.grading.grade === "" || form.grading.grade == null) e.gradingGrade = "Grade required";
  }
  if (form.quantity && (isNaN(Number(form.quantity)) || Number(form.quantity) < 1)) e.quantity = "Min 1";
  return { errors: e, ok: Object.keys(e).length === 0 };
};

// ---- blank + from-card state ------------------------------------------------
function blankForm() {
  return {
    player: "",
    additionalPlayersText: "",
    year: "",
    sport: "",
    team: "",
    brand: "Topps",
    set: "",
    subset: "",
    parallel: "Base",
    cardNumber: "",
    serialNumber: "",
    flags: { rookie: false, auto: false, relic: false, patch: false, shortPrint: false },
    graded: false,
    grading: { company: "PSA", grade: "", gradeLabel: "", certNumber: "" },
    condition: "",
    quantity: 1,
    pricePaid: "",
    acquiredDate: "",
    source: "",
    estimatedValue: "",
    notes: "",
  };
}

function formFromCard(card) {
  const f = blankForm();
  const g = card.grading || {};
  const acq = card.acquisition || {};
  return Object.assign(f, {
    player: card.player || "",
    additionalPlayersText: (card.additionalPlayers || []).join(", "),
    year: card.year != null ? String(card.year) : "",
    sport: card.sport || "",
    team: card.team || "",
    brand: card.brand || "Topps",
    set: card.set || "",
    subset: card.subset || "",
    parallel: card.parallel || "Base",
    cardNumber: card.cardNumber || "",
    serialNumber: card.serialNumber || "",
    flags: Object.assign(f.flags, card.flags || {}),
    graded: !!card.graded,
    grading: {
      company: g.company || "PSA",
      grade: g.grade != null ? String(g.grade) : "",
      gradeLabel: g.gradeLabel || "",
      certNumber: g.certNumber || "",
    },
    condition: card.condition || "",
    quantity: card.quantity || 1,
    pricePaid: acq.pricePaid != null ? String(acq.pricePaid) : "",
    acquiredDate: CV.fmt.dateInputValue(acq.date),
    source: acq.source || "",
    estimatedValue: card.estimatedValue != null ? String(card.estimatedValue) : "",
    notes: card.notes || "",
  });
}

// ---- assemble form → card doc (spec §5) ------------------------------------
function assemble(form, uid, photos, ai) {
  const numOrNull = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
  const strOrNull = (v) => (v && String(v).trim() ? String(v).trim() : null);

  let acqDate = null;
  if (form.acquiredDate) {
    const parts = form.acquiredDate.split("-");
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
      if (!isNaN(d)) acqDate = firebase.firestore.Timestamp.fromDate(d);
    }
  }

  const additionalPlayers = form.additionalPlayersText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const estimatedValue = numOrNull(form.estimatedValue);

  const data = {
    ownerId: uid,
    photos: {
      front: photos.front.stored,
      back: photos.back.stored,
    },
    year: numOrNull(form.year),
    brand: form.brand || "Other",
    set: strOrNull(form.set) || "",
    subset: strOrNull(form.subset),
    player: form.player.trim(),
    additionalPlayers: additionalPlayers,
    sport: form.sport,
    team: strOrNull(form.team),
    cardNumber: strOrNull(form.cardNumber),
    parallel: form.parallel && form.parallel.trim() ? form.parallel.trim() : "Base",
    serialNumber: strOrNull(form.serialNumber),
    flags: {
      rookie: !!form.flags.rookie,
      auto: !!form.flags.auto,
      relic: !!form.flags.relic,
      patch: !!form.flags.patch,
      shortPrint: !!form.flags.shortPrint,
    },
    graded: !!form.graded,
    grading: form.graded
      ? {
          company: form.grading.company,
          grade: numOrNull(form.grading.grade),
          gradeLabel: strOrNull(form.grading.gradeLabel),
          certNumber: strOrNull(form.grading.certNumber),
        }
      : null,
    condition: form.graded ? null : strOrNull(form.condition),
    quantity: form.quantity ? Number(form.quantity) : 1,
    acquisition: {
      pricePaid: numOrNull(form.pricePaid),
      date: acqDate,
      source: strOrNull(form.source),
    },
    estimatedValue: estimatedValue,
    valueSource: estimatedValue != null ? "manual" : null,
    valueUpdatedAt: estimatedValue != null ? CV.serverTimestamp() : null,
    gradedValueEstimates: {},
    compsUrl: null,
    // Provenance from the vision pass (spec §5) — the untouched suggestion and
    // its per-field confidence, so corrections can be measured later.
    aiSuggested: ai && ai.aiSuggested ? ai.aiSuggested : null,
    aiConfidence: ai && ai.aiConfidence ? ai.aiConfidence : null,
    notes: form.notes || "",
  };
  return data;
}

// ---- the ONE save path -----------------------------------------------------
// Uploads any newly-picked photos, then creates or updates the card.
// opts (optional): { cardId, ai } — the AI intake flow passes the intake id (so
// the already-uploaded images match the card path) and the vision provenance.
CV.saveCardFromForm = async function (mode, existingCard, form, photos, opts) {
  opts = opts || {};
  const uid = CV.auth.currentUser.uid;
  const cardId = mode === "edit" ? existingCard.id : opts.cardId || CV.newCardId();

  // Upload dirty sides; keep already-stored sides as-is.
  for (const side of ["front", "back"]) {
    const p = photos[side];
    if (p.dirty && p.fullBlob) {
      p.stored = await CV.uploadCardImage(uid, cardId, side, p.fullBlob, p.thumbBlob);
    } else {
      p.stored = p.stored || {
        path: p.path,
        url: p.url,
        thumbUrl: p.thumbUrl,
        thumbPath: p.thumbPath || (p.path ? p.path.replace(/\.jpg$/, "_thumb.jpg") : null),
      };
    }
  }

  const data = assemble(form, uid, photos, opts.ai);
  if (mode === "edit") {
    // Don't stomp createdAt on edit.
    await CV.updateCard(cardId, data);
  } else {
    await CV.createCard(cardId, data);
  }
  return Object.assign({ id: cardId }, data);
};

// ---- headless save from an analyzed intake row (bulk "Confirm all ready") --
// Uses the same assemble + validation as the form, so a queue-confirmed card is
// identical to a hand-confirmed one (spec §6). Throws if required fields are
// missing so the caller can leave the row for manual review.
CV.saveCardFromAI = async function (row) {
  const uid = CV.auth.currentUser.uid;
  const cardData = CV.ai.fieldsToCard(row.aiSuggested || {}, row.photos);
  const form = formFromCard(cardData);
  const photos = {
    front: Object.assign({}, row.photos.front, { stored: row.photos.front, dirty: false }),
    back: Object.assign({}, row.photos.back, { stored: row.photos.back, dirty: false }),
  };
  const v = CV.validateCard(form, photos);
  if (!v.ok) throw new Error("needs-review");
  const data = assemble(form, uid, photos, { aiSuggested: row.aiSuggested, aiConfidence: row.aiConfidence });
  await CV.createCard(row.id, data);
  return Object.assign({ id: row.id }, data);
};

// ---- the component ---------------------------------------------------------
CV.CardForm = function CardForm(props) {
  const mode = props.mode || "add";
  const existing = props.initial || null;
  const { useState } = React;

  const [form, setForm] = useState(existing ? formFromCard(existing) : blankForm());
  const [photos, setPhotos] = useState(function () {
    const ex = (existing && existing.photos) || {};
    const side = (s) =>
      s
        ? { url: s.url, thumbUrl: s.thumbUrl, path: s.path, thumbPath: s.thumbPath, stored: s, dirty: false }
        : {};
    return { front: side(ex.front), back: side(ex.back) };
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [processingSide, setProcessingSide] = useState(null);
  const [dupMatches, setDupMatches] = useState([]);

  // Per-field confidence from the vision pass. Only "low" is flagged, so the
  // confirm screen is a scan, not a re-entry (spec §4, §11).
  const conf = props.confidence || {};
  const low = (key) => conf[key] === "low";

  function swapSides() {
    setPhotos((p) => ({ front: p.back, back: p.front }));
  }

  function set(field, value) {
    setForm((f) => Object.assign({}, f, { [field]: value }));
  }
  function setFlag(key, value) {
    setForm((f) => Object.assign({}, f, { flags: Object.assign({}, f.flags, { [key]: value }) }));
  }
  function setGrading(key, value) {
    setForm((f) => Object.assign({}, f, { grading: Object.assign({}, f.grading, { [key]: value }) }));
  }

  async function pickPhoto(side, file) {
    if (!file) return;
    setSaveError("");
    setProcessingSide(side);
    try {
      const { fullBlob, thumbBlob, previewUrl } = await CV.images.process(file);
      setPhotos((p) =>
        Object.assign({}, p, {
          [side]: { previewUrl, fullBlob, thumbBlob, dirty: true },
        })
      );
    } catch (err) {
      setSaveError(err.message || "Could not process that image.");
    } finally {
      setProcessingSide(null);
    }
  }

  async function onSave() {
    const v = CV.validateCard(form, photos);
    setErrors(v.errors);
    if (!v.ok) {
      setSaveError("Please fix the highlighted fields.");
      return;
    }
    // Duplicate detection on save (spec §2, §14) — a suggestion, never a block.
    if (mode === "add" && props.cards) {
      const candidate = {
        id: props.saveOpts && props.saveOpts.cardId,
        year: form.year !== "" && !isNaN(Number(form.year)) ? Number(form.year) : null,
        brand: form.brand,
        set: form.set,
        cardNumber: form.cardNumber,
        parallel: form.parallel,
        graded: !!form.graded,
      };
      const dups = CV.findDuplicates(candidate, props.cards);
      if (dups.length) {
        setDupMatches(dups);
        return; // show the duplicate dialog; user chooses
      }
    }
    await actuallySave();
  }

  async function actuallySave() {
    setSaving(true);
    setSaveError("");
    try {
      const saved = await CV.saveCardFromForm(mode, existing, form, photos, props.saveOpts || {});
      props.onSaved && props.onSaved({ action: "created", cardId: saved.id, card: saved });
    } catch (err) {
      console.error(err);
      setSaveError(err.message || "Save failed. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function mergeIntoDuplicate() {
    const target = dupMatches[0];
    setSaving(true);
    setSaveError("");
    try {
      const qty = await CV.addToCardQuantity(target, 1);
      setDupMatches([]);
      props.onSaved &&
        props.onSaved({ action: "merged", cardId: target.id, card: Object.assign({}, target, { quantity: qty }) });
    } catch (err) {
      setSaveError(err.message || "Couldn't update the existing card.");
    } finally {
      setSaving(false);
    }
  }

  const grades = CV.lists.grades;

  return (
    <div className="cardform">
      {/* Photos */}
      <div className="form-section">
        <div className="graded-head">
          <label className="field-label" style={{ margin: 0 }}>
            Photos <span className="req">both required</span>
          </label>
          {props.showSwap && photos.front && photos.back ? (
            <button type="button" className="btn btn-ghost btn-swap" onClick={swapSides} disabled={saving}>
              <CV.Icons.Swap size={16} /> Swap sides
            </button>
          ) : null}
        </div>
        {props.confidence && props.sideCheck && (props.sideCheck.frontLooksLikeFront === false || props.sideCheck.backLooksLikeBack === false) ? (
          <div className="side-warn">These may be in the wrong order — check front/back and use Swap sides if needed.</div>
        ) : null}
        <div className="photo-tiles">
          <PhotoTile
            side="front"
            label="Front"
            photo={photos.front}
            error={errors.front}
            busy={processingSide === "front"}
            onPick={pickPhoto}
          />
          <PhotoTile
            side="back"
            label="Back"
            photo={photos.back}
            error={errors.back}
            busy={processingSide === "back"}
            onPick={pickPhoto}
          />
        </div>
      </div>

      {/* Identity */}
      <div className="form-grid">
        <Field label="Player" error={errors.player} flag={low("player")} full>
          <input className="input" value={form.player} onChange={(e) => set("player", e.target.value)} placeholder="e.g. Victor Wembanyama" />
        </Field>
        <Field label="Additional players" hint="comma-separated" full>
          <input className="input" value={form.additionalPlayersText} onChange={(e) => set("additionalPlayersText", e.target.value)} placeholder="optional" />
        </Field>

        <Field label="Year" error={errors.year} flag={low("year")}>
          <input className="input" inputMode="numeric" value={form.year} onChange={(e) => set("year", e.target.value)} placeholder="2023" />
        </Field>
        <Field label="Sport" error={errors.sport} flag={low("sport")}>
          <select className="input" value={form.sport} onChange={(e) => set("sport", e.target.value)}>
            <option value="">Select…</option>
            {CV.lists.sports.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Brand" flag={low("brand")}>
          <select className="input" value={form.brand} onChange={(e) => set("brand", e.target.value)}>
            {CV.lists.brands.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </Field>
        <Field label="Team" flag={low("team")}>
          <input className="input" value={form.team} onChange={(e) => set("team", e.target.value)} placeholder="optional" />
        </Field>

        <Field label="Set" flag={low("set")} full>
          <input className="input" value={form.set} onChange={(e) => set("set", e.target.value)} placeholder="e.g. Topps Chrome" />
        </Field>
        <Field label="Subset / insert" flag={low("subset")} full>
          <input className="input" value={form.subset} onChange={(e) => set("subset", e.target.value)} placeholder="e.g. Kaboom! (optional)" />
        </Field>

        <Field label="Parallel" flag={low("parallel")}>
          <input className="input" list="parallel-list" value={form.parallel} onChange={(e) => set("parallel", e.target.value)} placeholder="Base" />
          <datalist id="parallel-list">
            {CV.lists.parallels.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <Field label="Card #" flag={low("cardNumber")}>
          <input className="input mono" value={form.cardNumber} onChange={(e) => set("cardNumber", e.target.value)} placeholder="150" />
        </Field>

        <Field label="Serial #" hint="e.g. 12/99" flag={low("serialNumber")}>
          <input className="input mono" value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Quantity" error={errors.quantity}>
          <input className="input" inputMode="numeric" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
        </Field>
      </div>

      {/* Flags */}
      <div className="form-section">
        <label className="field-label">
          Attributes
          {low("flags") ? <span className="check-tag">check</span> : null}
        </label>
        <div className="toggle-row">
          {CV.lists.flags.map((f) => (
            <Toggle key={f.key} label={f.label} on={!!form.flags[f.key]} onClick={() => setFlag(f.key, !form.flags[f.key])} />
          ))}
        </div>
      </div>

      {/* Graded */}
      <div className="form-section">
        <div className="graded-head">
          <label className="field-label" style={{ margin: 0 }}>
            Graded
            {low("graded") ? <span className="check-tag">check</span> : null}
          </label>
          <Toggle label={form.graded ? "Graded" : "Raw"} on={form.graded} onClick={() => set("graded", !form.graded)} />
        </div>
        {form.graded ? (
          <div className="form-grid">
            <Field label="Company" error={errors.gradingCompany} flag={low("grading")}>
              <select className="input" value={form.grading.company} onChange={(e) => setGrading("company", e.target.value)}>
                {CV.lists.gradingCompanies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Grade" error={errors.gradingGrade} flag={low("grading")}>
              <select className="input" value={form.grading.grade} onChange={(e) => setGrading("grade", e.target.value)}>
                <option value="">—</option>
                {grades.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>
            <Field label="Grade label" hint="e.g. GEM MT">
              <input className="input" value={form.grading.gradeLabel} onChange={(e) => setGrading("gradeLabel", e.target.value)} placeholder="optional" />
            </Field>
            <Field label="Cert #">
              <input className="input mono" value={form.grading.certNumber} onChange={(e) => setGrading("certNumber", e.target.value)} placeholder="optional" />
            </Field>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Condition" flag={low("condition")} full>
              <select className="input" value={form.condition} onChange={(e) => set("condition", e.target.value)}>
                <option value="">Select… (optional)</option>
                {CV.lists.conditions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>

      {/* Acquisition + value */}
      <div className="form-section">
        <label className="field-label">Acquisition &amp; value</label>
        <div className="form-grid">
          <Field label="Paid ($)">
            <input className="input" inputMode="decimal" value={form.pricePaid} onChange={(e) => set("pricePaid", e.target.value)} placeholder="optional" />
          </Field>
          <Field label="Acquired">
            <input className="input" type="date" value={form.acquiredDate} onChange={(e) => set("acquiredDate", e.target.value)} />
          </Field>
          <Field label="Source">
            <input className="input" value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="e.g. eBay, card show" />
          </Field>
          <Field label="Est. value ($)" hint="comps come in Phase 2">
            <input className="input" inputMode="decimal" value={form.estimatedValue} onChange={(e) => set("estimatedValue", e.target.value)} placeholder="optional" />
          </Field>
        </div>
      </div>

      {/* Notes */}
      <div className="form-section">
        <label className="field-label">Notes</label>
        <textarea className="input textarea" rows="3" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Free text — color, not filter data." />
      </div>

      {saveError ? <div className="form-error">{saveError}</div> : null}

      <div className="form-actions">
        {props.onSkip ? (
          <button className="btn btn-ghost" onClick={props.onSkip} disabled={saving}>Skip</button>
        ) : (
          <button className="btn btn-ghost" onClick={props.onCancel} disabled={saving}>Cancel</button>
        )}
        <button className="btn btn-primary" onClick={onSave} disabled={saving || !!processingSide}>
          {saving ? "Saving…" : mode === "edit" ? "Save changes" : props.saveLabel || "Save card"}
        </button>
      </div>

      {/* Duplicate suggestion (spec §2, §14) — never a block */}
      <CV.Modal open={dupMatches.length > 0} title="Looks like a duplicate" onClose={saving ? function () {} : () => setDupMatches([])}>
        <p className="modal-msg">
          You already have {dupMatches.length === 1 ? "a card" : dupMatches.length + " cards"} that matches this
          year, brand, set, card&nbsp;#, parallel and raw/graded. Add one to that card's quantity instead of
          creating a new record?
        </p>
        {dupMatches[0] ? (
          <div className="dup-row">
            {dupMatches[0].photos && dupMatches[0].photos.front && dupMatches[0].photos.front.thumbUrl ? (
              <img className="dup-thumb" src={dupMatches[0].photos.front.thumbUrl} alt="" />
            ) : null}
            <div className="dup-info">
              <div className="dup-player">{dupMatches[0].player || "Unknown"}</div>
              <div className="dup-set">{CV.fmt.setLine(dupMatches[0])}</div>
              <div className="dup-qty">Currently qty {dupMatches[0].quantity || 1}</div>
            </div>
          </div>
        ) : null}
        <div className="modal-actions modal-actions-stack">
          <button className="btn btn-primary" onClick={mergeIntoDuplicate} disabled={saving}>
            {saving ? "Working…" : "Add 1 to quantity"}
          </button>
          <button className="btn btn-ghost" onClick={() => { setDupMatches([]); actuallySave(); }} disabled={saving}>
            Save as a new card
          </button>
          <button className="btn btn-ghost" onClick={() => setDupMatches([])} disabled={saving}>
            Cancel
          </button>
        </div>
      </CV.Modal>
    </div>
  );
};

// ---- small building blocks -------------------------------------------------
function Field(props) {
  return (
    <div className={"field" + (props.full ? " field-full" : "") + (props.flag ? " field-check" : "")}>
      <label className="field-label">
        {props.label}
        {props.hint ? <span className="field-hint"> {props.hint}</span> : null}
        {props.flag ? <span className="check-tag">check</span> : null}
      </label>
      {props.children}
      {props.error ? <div className="field-err">{props.error}</div> : null}
    </div>
  );
}

function Toggle(props) {
  return (
    <button type="button" className={"toggle" + (props.on ? " toggle-on" : "")} onClick={props.onClick}>
      {props.label}
    </button>
  );
}

function PhotoTile(props) {
  const p = props.photo || {};
  const src = p.previewUrl || p.thumbUrl || p.url || null;
  const inputId = "photo-" + props.side;
  return (
    <div className="photo-tile-wrap">
      <label htmlFor={inputId} className={"photo-tile" + (props.error ? " photo-tile-err" : "")}>
        {src ? (
          <img src={src} alt={props.label} className="photo-tile-img" />
        ) : (
          <div className="photo-tile-empty">
            <CV.Icons.Camera size={26} />
            <span>{props.label}</span>
          </div>
        )}
        {props.busy ? <div className="photo-tile-busy">Processing…</div> : null}
        {src ? <div className="photo-tile-label">{props.label}</div> : null}
      </label>
      <input
        id={inputId}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          props.onPick(props.side, f);
          e.target.value = "";
        }}
      />
      {props.error ? <div className="field-err">{props.error}</div> : null}
    </div>
  );
}
