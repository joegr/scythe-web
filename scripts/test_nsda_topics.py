"""nsda_topics: the monthly refresh only adds topics, and stops if the page lost any the file has.

    python3 -m unittest discover -s scripts
"""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import nsda_topics
from nsda_topics import Refused, parse, refresh

POLICY = "Resolved: The United States federal government should substantially increase its exploration of the Arctic."
LD = "Resolved: Outer space colonization is a moral imperative."
LD_NEW = "Resolved: De-extinction is unethical."
PF = "Resolved: The United States should ban stock trading by members of Congress."
BQ = "Resolved: Technological progress has surpassed humanity’s ability to use it ethically."


def page(ld: list[str]) -> str:
    def toggle(name: str, body: str) -> str:
        return f'<h5 class="et_pb_toggle_title">Past Topics - {name}</h5><div>{body}</div>'
    return "".join([
        toggle("Policy Debate", f"<h5>2026-2027</h5><p>{POLICY}</p>"),
        toggle("Lincoln-Douglas Debate", "<h5>2026-2027</h5><ul>" + "".join(f"<li>{x}</li>" for x in ld) + "</ul>"),
        toggle("Public Forum Debate", f"<h5>2026-2027</h5><p>September/October – {PF}</p>"),
        toggle("Big Questions", f"<p><strong>2026-2027</strong> – {BQ}</p>"),
    ])


SEP_OCT = page([f"September/October – {LD}"])
NOV_DEC = page([f"November/December – {LD_NEW}", f"September/October – {LD}"])


class Refresh(unittest.TestCase):
    def test_adds_the_new_topics(self):
        old = parse(SEP_OCT)
        rows, added = refresh(NOV_DEC, old)
        self.assertEqual([r["resolution"] for r in added], [LD_NEW])
        self.assertEqual(added[0]["slug"], "ld-2026-27-novdec-de-extinction-unethical")
        self.assertLess({r["slug"] for r in old}, {r["slug"] for r in rows})

    def test_stops_when_a_topic_is_gone(self):
        with self.assertRaisesRegex(Refused, "ld-2026-27-sepoct-outer-space-colonization"):
            refresh(page([f"November/December – {LD_NEW}"]), parse(SEP_OCT))

    def test_a_reworded_topic_keeps_its_slug_and_takes_the_new_wording(self):
        rows, added = refresh(page([f"September/October – {LD[:-1]} for humanity."]), parse(SEP_OCT))
        self.assertEqual(added, [])
        self.assertEqual([r["resolution"] for r in rows if r["event"] == "ld"], [f"{LD[:-1]} for humanity."])

    def test_stops_when_an_event_is_empty(self):
        with self.assertRaisesRegex(Refused, "no topics for ld"):
            refresh(page([]), [])


class Main(unittest.TestCase):
    def test_writes_nothing_when_it_stops(self):
        with tempfile.TemporaryDirectory() as d:
            out, html = Path(d) / "nsda_topics.json", Path(d) / "topics.html"
            out.write_text(json.dumps(parse(SEP_OCT), ensure_ascii=False, indent=1), encoding="utf-8")
            before = out.read_text(encoding="utf-8")
            html.write_text(page([]), encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(nsda_topics.main(["--html", str(html), "--out", str(out)]), 1)
            self.assertEqual(out.read_text(encoding="utf-8"), before)
            html.write_text(NOV_DEC, encoding="utf-8")
            with redirect_stdout(io.StringIO()):
                self.assertEqual(nsda_topics.main(["--html", str(html), "--out", str(out)]), 0)
            self.assertEqual(len(json.loads(out.read_text(encoding="utf-8"))), 5)

    def test_the_bundled_file_is_what_the_script_writes(self):
        rows = json.loads(nsda_topics.OUT.read_text(encoding="utf-8"))
        self.assertEqual(json.dumps(rows, ensure_ascii=False, indent=1), nsda_topics.OUT.read_text(encoding="utf-8"))
        self.assertEqual(len({r["slug"] for r in rows}), len(rows))
        for r in rows:
            self.assertEqual(r["slug"], nsda_topics.slugify(r["event"], r["season"], r["period"], r["resolution"]))


if __name__ == "__main__":
    unittest.main()
