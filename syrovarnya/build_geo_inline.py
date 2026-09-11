"""Собирает syrovarnya/geo-map.inline.html из geo-map.css + geo-map.js —
один самодостаточный блок для вставки в страницу без внешних файлов."""
import pathlib
here = pathlib.Path(__file__).parent
css = (here / "geo-map.css").read_text(encoding="utf-8")
js = (here / "geo-map.js").read_text(encoding="utf-8")
out = here / "geo-map.inline.html"
head = out.read_text(encoding="utf-8").split("<style>")[0] if out.exists() else ""
out.write_text(head + "<style>\n" + css + "\n</style>\n<div id=\"atomusGeo\"></div>\n<script>\n" + js + "\n</script>\n<!-- ===== /geo-map ===== -->\n", encoding="utf-8")
print("ok", out, out.stat().st_size, "bytes")
