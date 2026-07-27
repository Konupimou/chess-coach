#!/usr/bin/env python3
"""Validate the checked-in Chess Knowledge Ontology."""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ONTOLOGY_PATH = ROOT / "chess-ontology.json"
ALLOWED_DIFFICULTIES = {"beginner", "intermediate", "advanced", "expert"}
ALLOWED_PHASES = {"opening", "middlegame", "endgame", "universal"}
ID_PATTERN = re.compile(r"^[a-z._]+$")
REQUIRED_CATEGORIES = {
    "Opening", "Tactical Motifs", "Checkmate Patterns", "Strategy",
    "Positional Play", "Piece Activity", "Piece Evaluation", "Pawn Structures",
    "Pawn Play", "Attack", "King Attack", "Defence", "Prophylaxis",
    "Exchanges and Transformations", "Calculation", "Evaluation", "Planning",
    "Decision Making", "Pawn Endgames", "Rook Endgames", "Queen Endgames",
    "Bishop Endgames", "Knight Endgames", "Bishop versus Knight",
    "Minor-Piece Endgames", "Mixed-Material Endgames",
    "Fortresses and Drawing Mechanisms", "Conversion of Advantages",
    "Practical Chess", "Psychology", "Time Management", "Training Methods",
    "Game Analysis", "Mistake Classification", "Opening Preparation",
    "Pattern Recognition",
}
REQUIRED_FIELDS = {
    "id", "title", "aliases", "category", "subcategory", "parent_id",
    "description", "recognition", "requirements", "typical_preconditions",
    "plans", "attacking_methods", "defensive_methods", "common_mistakes",
    "exceptions", "engine_indicators", "coach_prompts", "related_concepts",
    "opposite_concepts", "broader_concepts", "narrower_concepts", "keywords",
    "difficulty", "game_phases", "importance", "review_status", "sources",
}
ARRAY_FIELDS = {
    "aliases", "recognition", "requirements", "typical_preconditions", "plans",
    "attacking_methods", "defensive_methods", "common_mistakes", "exceptions",
    "engine_indicators", "coach_prompts", "related_concepts", "opposite_concepts",
    "broader_concepts", "narrower_concepts", "keywords", "game_phases", "sources",
}


def fail(errors: list[str], message: str) -> None:
    errors.append(message)


def main() -> int:
    errors: list[str] = []
    try:
        payload = json.loads(ONTOLOGY_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"ERROR: {ONTOLOGY_PATH.name} does not exist.", file=sys.stderr)
        return 1
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON: {exc}", file=sys.stderr)
        return 1

    concepts = payload.get("concepts")
    if not isinstance(concepts, list):
        print("ERROR: top-level 'concepts' must be an array.", file=sys.stderr)
        return 1
    if not 500 <= len(concepts) <= 850:
        fail(errors, f"concept count {len(concepts)} is outside the allowed range 500..850")

    ids = [item.get("id") for item in concepts if isinstance(item, dict)]
    duplicate_ids = sorted(key for key, count in Counter(ids).items() if key and count > 1)
    if duplicate_ids:
        fail(errors, f"duplicate IDs: {', '.join(duplicate_ids)}")
    id_set = {value for value in ids if isinstance(value, str)}

    title_keys = [
        (item.get("category"), item.get("title"))
        for item in concepts if isinstance(item, dict)
    ]
    duplicate_titles = sorted(
        f"{category} / {title}"
        for (category, title), count in Counter(title_keys).items()
        if category and title and count > 1
    )
    if duplicate_titles:
        fail(errors, f"duplicate titles within a category: {', '.join(duplicate_titles)}")

    categories: set[str] = set()
    subcategories: set[tuple[str, str]] = set()
    for index, concept in enumerate(concepts):
        label = f"concept[{index}]"
        if not isinstance(concept, dict):
            fail(errors, f"{label} is not an object")
            continue
        missing = sorted(REQUIRED_FIELDS - concept.keys())
        if missing:
            fail(errors, f"{label} missing fields: {', '.join(missing)}")
        identifier = concept.get("id")
        if not isinstance(identifier, str) or not identifier:
            fail(errors, f"{label} has an empty or non-string ID")
        elif not ID_PATTERN.fullmatch(identifier):
            fail(errors, f"{label} has invalid ID '{identifier}'")
        category = concept.get("category")
        subcategory = concept.get("subcategory")
        if not isinstance(category, str) or not category.strip():
            fail(errors, f"{label} has an empty category")
        else:
            categories.add(category)
        if not isinstance(subcategory, str) or not subcategory.strip():
            fail(errors, f"{label} has an empty subcategory")
        elif isinstance(category, str):
            subcategories.add((category, subcategory))
        for field in ARRAY_FIELDS:
            if field in concept and not isinstance(concept[field], list):
                fail(errors, f"{label}.{field} must be an array")
        if concept.get("difficulty") not in ALLOWED_DIFFICULTIES:
            fail(errors, f"{label} has invalid difficulty '{concept.get('difficulty')}'")
        importance = concept.get("importance")
        if not isinstance(importance, int) or isinstance(importance, bool) or not 1 <= importance <= 10:
            fail(errors, f"{label} has invalid importance '{importance}'")
        phases = concept.get("game_phases", [])
        invalid_phases = set(phases) - ALLOWED_PHASES if isinstance(phases, list) else set()
        if invalid_phases:
            fail(errors, f"{label} has invalid game phases: {sorted(invalid_phases)}")
        if concept.get("review_status") != "ontology_only":
            fail(errors, f"{label} review_status must be 'ontology_only'")
        if concept.get("sources") != []:
            fail(errors, f"{label} sources must initially be empty")
        for field in ("related_concepts", "opposite_concepts", "broader_concepts", "narrower_concepts"):
            for target in concept.get(field, []):
                if target not in id_set:
                    fail(errors, f"{label}.{field} references missing ID '{target}'")
        parent_id = concept.get("parent_id")
        if parent_id is not None and parent_id not in id_set:
            fail(errors, f"{label}.parent_id references missing ID '{parent_id}'")

    if payload.get("concept_count") != len(concepts):
        fail(errors, "top-level concept_count does not match the concepts array")
    missing_categories = sorted(REQUIRED_CATEGORIES - categories)
    if missing_categories:
        fail(errors, f"missing required categories: {', '.join(missing_categories)}")

    csv_path = ROOT / "chess-ontology.csv"
    md_path = ROOT / "chess-ontology.md"
    if not csv_path.exists():
        fail(errors, "chess-ontology.csv does not exist")
    else:
        import csv
        with csv_path.open(encoding="utf-8", newline="") as handle:
            csv_rows = list(csv.DictReader(handle))
        csv_ids = [row.get("id") for row in csv_rows]
        if len(csv_rows) != len(concepts):
            fail(errors, f"CSV contains {len(csv_rows)} rows; expected {len(concepts)}")
        if set(csv_ids) != id_set:
            fail(errors, "CSV concept IDs do not match JSON concept IDs")
    if not md_path.exists():
        fail(errors, "chess-ontology.md does not exist")
    else:
        markdown = md_path.read_text(encoding="utf-8")
        missing_markdown_ids = [
            identifier for identifier in id_set
            if f"- ID: `{identifier}`" not in markdown
        ]
        if missing_markdown_ids:
            fail(
                errors,
                f"Markdown is missing {len(missing_markdown_ids)} concept ID(s): "
                + ", ".join(sorted(missing_markdown_ids)[:10]),
            )

    if errors:
        print(f"Ontology validation failed with {len(errors)} error(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        "Ontology validation passed: "
        f"{len(categories)} categories, {len(subcategories)} subcategories, "
        f"{len(concepts)} concepts."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
