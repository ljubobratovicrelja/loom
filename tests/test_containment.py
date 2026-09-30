"""Tests for output-containment validation and owned output tree cleanup."""

from pathlib import Path

from loom.runner import PipelineConfig
from loom.runner.clean import clean_pipeline_data, describe_path, get_output_root


def _write_pipeline(dir_path: Path, body: str) -> PipelineConfig:
    config_file = dir_path / "pipeline.yml"
    config_file.write_text(body)
    return PipelineConfig.from_yaml(config_file)


CONTAINMENT_YAML = """
output_dir: output

data:
  src:
    type: txt
    path: data/src.txt
  good:
    type: txt
    path: output/good.txt
  legacy:
    type: txt
    path: data/legacy.txt
  escaped:
    type: txt
    path: ../escaped.txt
  external:
    type: txt
    path: /tmp/loom-external.txt
    allow_outside_pipeline: true

pipeline:
  - name: s
    task: t.py
    inputs:
      a: $src
    outputs:
      b: $good
      c: $legacy
      d: $escaped
      e: $external
"""


class TestContainmentIssues:
    def test_output_root_points_at_output_dir(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path, CONTAINMENT_YAML)
        assert config.output_root == (tmp_path / "output").resolve()

    def test_flags_escape_and_legacy_keeps_good_and_external(self, tmp_path: Path) -> None:
        config = _write_pipeline(tmp_path, CONTAINMENT_YAML)
        issues = config.containment_issues()
        messages = {message for _, message in issues}
        levels = {message: level for level, message in issues}

        assert any("'good'" in m for m in messages) is False
        assert any("'src'" in m for m in messages) is False
        assert any("'external'" in m for m in messages) is False

        legacy = next(m for m in messages if "'legacy'" in m)
        assert levels[legacy] == "warning"

        escaped = next(m for m in messages if "'escaped'" in m)
        assert levels[escaped] == "error"

    def test_clean_pipeline_has_no_issues(self, tmp_path: Path) -> None:
        config = _write_pipeline(
            tmp_path,
            """
data:
  out:
    type: txt
    path: output/out.txt
pipeline:
  - name: s
    task: t.py
    outputs:
      -o: $out
""",
        )
        assert config.containment_issues() == []


class TestOutputRootCleanup:
    def _config(self, tmp_path: Path) -> PipelineConfig:
        return _write_pipeline(
            tmp_path,
            """
data:
  report:
    type: json
    path: output/report.json
pipeline:
  - name: make
    task: t.py
    outputs:
      -o: $report
""",
        )

    def test_get_output_root_none_without_produced_files(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        assert get_output_root(config) is None

    def test_clean_purges_owned_output_tree(self, tmp_path: Path) -> None:
        config = self._config(tmp_path)
        (tmp_path / "output" / "nested").mkdir(parents=True)
        (tmp_path / "output" / "report.json").write_text("{}")

        results = clean_pipeline_data(config, permanent=True)

        assert not (tmp_path / "output").exists()
        assert any(r.path == (tmp_path / "output").resolve() for r in results)


class TestDescribePath:
    def test_directory_reports_entry_count_and_sample(self, tmp_path: Path) -> None:
        folder = tmp_path / "output" / "input"
        folder.mkdir(parents=True)
        (folder / "a.txt").write_text("a")
        (folder / "b.txt").write_text("b")

        info = describe_path(folder, tmp_path)

        assert info["is_dir"] is True
        assert info["entry_count"] == 2
        assert set(info["sample"]) == {"a.txt", "b.txt"}
        assert info["inside_pipeline"] is True

    def test_outside_pipeline_is_flagged(self, tmp_path: Path) -> None:
        outside = tmp_path.parent / "elsewhere"
        outside.mkdir(exist_ok=True)
        info = describe_path(outside, tmp_path / "pipeline")
        assert info["inside_pipeline"] is False
