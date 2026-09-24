"""MkDocs hook: links that leave the published site point at the repository instead.

The manual links to files the site does not publish: the repository root (`../ROADMAP.md`,
`../SECURITY.md`), the audit record (`audit/`) and the page templates (`_templates/`). Built
as-is, each would be a dead link on the site and would fail `mkdocs build --strict`.

This rewrites exactly those links to the file's page on the code host, keeping any `#anchor`.
Every other link is left alone, so a genuinely broken one still fails the strict build.
Fenced code blocks are skipped. The repository URL comes from `repo_url` in mkdocs.yml.
"""

import os
import re

EXCLUDED_PREFIXES = ("audit/", "_templates/", "assets/demo-site/", "assets/src/")
LINK = re.compile(r"\]\(([^)\s]+)\)")
FENCE = re.compile(r"^\s*```")


def _rewrite(target, page_dir, docs_dir, blob):
    if re.match(r"^[a-z]+:", target) or target.startswith("#"):
        return None
    path, _, anchor = target.partition("#")
    if not path:
        return None
    absolute = os.path.normpath(os.path.join(docs_dir, page_dir, path))
    in_docs = os.path.relpath(absolute, docs_dir)
    outside = in_docs.startswith("..")
    excluded = not outside and in_docs.replace(os.sep, "/").startswith(EXCLUDED_PREFIXES)
    if not (outside or excluded):
        return None
    repo_root = os.path.dirname(docs_dir)
    repo_path = os.path.relpath(absolute, repo_root).replace(os.sep, "/")
    return f"{blob}/{repo_path}" + (f"#{anchor}" if anchor else "")


def on_page_markdown(markdown, page, config, files):
    repo = (config.get("repo_url") or "").rstrip("/")
    if not repo:
        return markdown
    blob = f"{repo}/blob/master"
    docs_dir = os.path.abspath(config["docs_dir"])
    page_dir = os.path.dirname(page.file.src_path)
    out, fenced = [], False
    for line in markdown.split("\n"):
        if FENCE.match(line):
            fenced = not fenced
        if not fenced:
            line = LINK.sub(
                lambda m: f"]({_rewrite(m.group(1), page_dir, docs_dir, blob) or m.group(1)})",
                line,
            )
        out.append(line)
    return "\n".join(out)
