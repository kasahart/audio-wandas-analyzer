"""What python-backend/conftest.py does for every test run, held on a run of its own (pytest in a subprocess)."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent


def test_a_failure_whose_report_carries_a_lone_surrogate_is_reported_and_does_not_crash_an_xdist_worker(
    tmp_path: Path,
) -> None:
    # An assertion's diff of strings shows them as they are: here a lone surrogate, which a pytest-xdist worker cannot
    # send to its controller as UTF-8. Without conftest.py's escaping the worker crashed (INTERNALERROR, exit 3) and the
    # failure itself never showed; on Windows CI that hid which test had failed.
    (tmp_path / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    (tmp_path / "test_probe.py").write_text(
        'def test_a_lone_surrogate_in_a_diff():\n    assert "\\ud800 left" == "right"\n', encoding="utf-8"
    )
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(HERE), os.environ.get("PYTHONPATH")]))}
    env.pop("PYTEST_XDIST_WORKER", None)
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "conftest", "-n", "1", "-c", str(tmp_path / "pytest.ini")]
        + ["--rootdir", str(tmp_path), "-p", "no:cacheprovider", str(tmp_path)],
        cwd=tmp_path,
        capture_output=True,
        encoding="utf-8",
        errors="backslashreplace",
        env=env,
        timeout=120,
    )
    assert run.returncode == 1, run.stdout + run.stderr
    assert "INTERNALERROR" not in run.stdout + run.stderr
    assert "FAILED test_probe.py::test_a_lone_surrogate_in_a_diff" in run.stdout
    assert "\\ud800 left" in run.stdout, "the failure is shown, the surrogate as its escape"


def test_a_backend_thread_that_outlives_its_test_fails_it_and_no_later_test_runs_while_it_does(tmp_path: Path) -> None:
    # A backend thread writes into whatever reply stream is in place when it writes (backend_server._emit): one left
    # running by its test once wrote into the next test's stream on Windows CI, and that test failed on a reply that
    # was not its own. Without conftest.py's guard, both tests of the probe pass.
    (tmp_path / "pytest.ini").write_text("[pytest]\n", encoding="utf-8")
    (tmp_path / "test_probe.py").write_text(
        "import threading\n"
        "release = threading.Event()\n"
        "def test_a_leaves_a_backend_thread_running():\n"
        "    threading.Thread(target=release.wait, name='awa-test-leaked', daemon=True).start()\n"
        "def test_b_comes_after_it():\n"
        "    release.set()\n",
        encoding="utf-8",
    )
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(HERE), os.environ.get("PYTHONPATH")]))}
    env.pop("PYTEST_XDIST_WORKER", None)
    run = subprocess.run(
        [sys.executable, "-m", "pytest", "-p", "conftest", "-p", "no:xdist", "-c", str(tmp_path / "pytest.ini")]
        + ["--rootdir", str(tmp_path), "-p", "no:cacheprovider", "-rA", str(tmp_path)],
        cwd=tmp_path,
        capture_output=True,
        encoding="utf-8",
        errors="backslashreplace",
        env=env,
        timeout=120,
    )
    out = run.stdout + run.stderr
    assert run.returncode == 1, out
    assert "ERROR test_probe.py::test_a_leaves_a_backend_thread_running" in run.stdout, out
    assert "backend thread(s) outlived their test: ['awa-test-leaked']" in run.stdout, out
    assert "ERROR test_probe.py::test_b_comes_after_it" in run.stdout, out
    assert "backend thread(s) of an earlier test still running, so this test cannot run: ['awa-test-leaked']" in out
