// components/CardTile.js — one tile in the 2-up collection grid (spec §3).
// Graded cards render inside a "slab" frame; raw cards render as a plain card.
window.CV = window.CV || {};

CV.CardTile = function CardTile(props) {
  const card = props.card;
  const thumb = (card.photos && card.photos.front && (card.photos.front.thumbUrl || card.photos.front.url)) || null;
  const isGraded = !!card.graded;
  const parallel = card.parallel && card.parallel !== "Base" ? card.parallel : "";
  const shiny = /refractor|prizm|chrome|silver|holo|mojo|wave|shimmer|superfractor|atomic/i.test(parallel);

  const valued = card.estimatedValue != null && !isNaN(Number(card.estimatedValue));

  return (
    <button className={"tile" + (isGraded ? " tile-slab" : "")} onClick={() => props.onOpen(card)}>
      {isGraded ? (
        <div className="slab-strip">
          {(card.grading && card.grading.company) || "GRADED"}{" "}
          {card.grading && card.grading.grade != null ? card.grading.grade : ""}
          {card.grading && card.grading.gradeLabel ? " · " + card.grading.gradeLabel : ""}
        </div>
      ) : null}

      <div className={"tile-img-wrap" + (shiny ? " shiny" : "")}>
        {thumb ? (
          <img src={thumb} alt={card.player} className="tile-img" loading="lazy" />
        ) : (
          <div className="tile-img placeholder">No image</div>
        )}
      </div>

      <div className="tile-body">
        <div className="tile-player">{card.player || "Unknown"}</div>
        <div className="tile-set">{CV.fmt.setLine(card)}</div>
        <div className="tile-foot">
          <span className={"tile-value" + (valued ? "" : " tile-value-empty")}>
            {valued ? CV.fmt.money(card.estimatedValue) : "—"}
          </span>
          <span className={"tile-tag " + (isGraded ? "tag-graded" : "tag-raw")}>
            {isGraded ? CV.fmt.gradeTag(card) : "Raw"}
          </span>
        </div>
      </div>
    </button>
  );
};
