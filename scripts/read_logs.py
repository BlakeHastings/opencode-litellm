"""Filter litellm-plugin log lines from the most recent OpenCode log file."""

import os
import sys
from pathlib import Path

import click


def get_log_dir() -> Path:
    base = Path(os.environ.get("USERPROFILE", Path.home())) if sys.platform == "win32" else Path.home()
    return base / ".local" / "share" / "opencode" / "log"


@click.command()
@click.option("--lines", "-n", default=100, show_default=True, help="Last N matching lines to show (0 = all)")
@click.option("--all-logs", is_flag=True, help="Search all retained log files, not just the most recent")
def main(lines: int, all_logs: bool) -> None:
    """Filter litellm-plugin log lines from the most recent OpenCode log file."""
    log_dir = get_log_dir()

    if not log_dir.exists():
        raise click.ClickException(f"OpenCode log directory not found: {log_dir}")

    log_files = sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)

    if not log_files:
        raise click.ClickException(f"No .log files found in {log_dir}")

    files_to_search = log_files if all_logs else log_files[:1]

    found_any = False
    for log_file in files_to_search:
        try:
            all_lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as e:
            click.echo(f"[WARN] Could not read {log_file.name}: {e}", err=True)
            continue

        plugin_lines = [line.rstrip() for line in all_lines if "litellm-plugin" in line]

        if lines > 0:
            plugin_lines = plugin_lines[-lines:]

        click.echo(f"=== {log_file.name} - {len(plugin_lines)} litellm-plugin line(s) ===")
        if plugin_lines:
            found_any = True
            for ln in plugin_lines:
                click.echo(ln)
        else:
            click.echo("(no litellm-plugin lines in this file)")
        click.echo()

    if not found_any:
        click.echo(
            "No litellm-plugin lines found. Restart OpenCode to trigger the config hook."
        )


if __name__ == "__main__":
    main()
