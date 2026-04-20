"""Wipe opencode-litellm plugin config for a fresh-start."""

import json
import os
import shutil
import sys
from pathlib import Path

import click


def home() -> Path:
    if sys.platform == "win32":
        return Path(os.environ.get("USERPROFILE", Path.home()))
    return Path.home()


def opencode_config_path() -> Path:
    return home() / ".config" / "opencode" / "opencode.json"


def auth_store_path() -> Path:
    return home() / ".local" / "share" / "opencode" / "auth.json"


def plugin_cache_root() -> Path:
    return home() / ".cache" / "opencode" / "packages"


def _load_json(path: Path):
    """Load JSON from path. Returns (data, status) where status is 'ok', 'missing', or 'unreadable'."""
    if not path.exists():
        return None, "missing"
    try:
        return json.loads(path.read_text(encoding="utf-8")), "ok"
    except (OSError, json.JSONDecodeError):
        return None, "unreadable"


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def wipe_opencode_provider(dry_run: bool) -> str:
    path = opencode_config_path()
    data, status = _load_json(path)
    if status == "missing":
        return f"skipped (not present): {path}"
    if status == "unreadable":
        return f"skipped (unparseable - hand-edit may need JSON fix): {path}"

    provider = data.get("provider")
    if not isinstance(provider, dict) or "litellm" not in provider:
        return f"skipped (no provider.litellm): {path}"

    if dry_run:
        return f"would remove provider.litellm from: {path}"

    provider.pop("litellm", None)
    if not provider:
        data.pop("provider", None)
    _write_json(path, data)
    return f"removed provider.litellm from: {path}"


def wipe_auth_entry(dry_run: bool) -> str:
    path = auth_store_path()
    data, status = _load_json(path)
    if status == "missing":
        return f"skipped (not present): {path}"
    if status == "unreadable":
        return f"skipped (unparseable): {path}"
    if "litellm" not in data:
        return f"skipped (no litellm credential): {path}"

    if dry_run:
        return f"would remove litellm credential from: {path}"

    data.pop("litellm", None)
    _write_json(path, data)
    return f"removed litellm credential from: {path}"


def wipe_plugin_cache(dry_run: bool) -> list[str]:
    """Delete every cached opencode-litellm@* package directory.

    OpenCode caches npm-sourced plugins under ~/.cache/opencode/packages/<name>@<tag>/.
    A stale cache here masks local src/index.ts edits whenever a consumer's
    opencode.json references the plugin by tag rather than path.
    """
    root = plugin_cache_root()
    if not root.exists():
        return [f"skipped (cache root not present): {root}"]

    matches = sorted(p for p in root.iterdir() if p.is_dir() and p.name.startswith("opencode-litellm@"))
    if not matches:
        return [f"skipped (no opencode-litellm@* cache entries): {root}"]

    verb = "would remove" if dry_run else "removed"
    results: list[str] = []
    for path in matches:
        if not dry_run:
            shutil.rmtree(path, ignore_errors=True)
        results.append(f"{verb} cached plugin: {path}")
    return results


@click.command()
@click.option("--dry-run", is_flag=True, help="Print what would be removed without modifying files")
def main(dry_run: bool) -> None:
    """Wipe opencode-litellm plugin config so the next /connect litellm run starts fresh.

    Clears, in order:
      1. provider.litellm in ~/.config/opencode/opencode.json (surgical)
      2. litellm entry in ~/.local/share/opencode/auth.json (surgical)
      3. every opencode-litellm@* directory under ~/.cache/opencode/packages/

    Safe to run when any of these are absent.
    """
    header = "[dry run] " if dry_run else ""
    click.echo(f"{header}opencode-litellm reset")
    click.echo(f"  - {wipe_opencode_provider(dry_run)}")
    click.echo(f"  - {wipe_auth_entry(dry_run)}")
    for line in wipe_plugin_cache(dry_run):
        click.echo(f"  - {line}")
    if dry_run:
        click.echo("\nNo files were modified. Re-run without --dry-run to apply.")
    else:
        click.echo("\nDone. Run /connect litellm to reconfigure.")


if __name__ == "__main__":
    main()
