# T-002: Backend dependency manifest and virtual environment

## Metadata
- **Group:** [TG-01 — Infrastructure & Project Scaffold](index.md)
- **Component:** Backend (Python)
- **Agent:** dev
- **Effort:** S
- **Risk:** LOW
- **Depends on:** [T-001](T-001-monorepo-scaffold.md)
- **Blocks:** [T-004](../TG-02-backend-core/T-004-app-factory-config.md)
- **Requirements:** [NFR-005](../../../define-requirements/NFR/NFR-005-security.md)

## Description
Create `backend/requirements.txt` (or `pyproject.toml`) pinning all Python dependencies for the MVP: FastAPI, Uvicorn, Pydantic v2, pydantic-settings, Pillow, OpenCV (`opencv-python-headless`), scikit-image, NumPy, exifread, piexif, python-magic, and filetype. Provide a `backend/Dockerfile` that installs these dependencies into the image and passes a `pip check` at build time.

## Acceptance criteria

```gherkin
Feature: Backend dependency manifest

  Scenario: Backend Docker image builds without dependency conflicts
    Given the backend/Dockerfile and requirements.txt are committed
    When "docker build ./backend" is executed
    Then the build exits with code 0
    And "pip check" inside the image reports no broken requirements

  Scenario: All required libraries are importable at runtime
    Given the backend Docker image is built
    When a Python interpreter inside the container runs
      "import fastapi, uvicorn, pydantic, PIL, cv2, skimage, numpy, exifread, piexif, magic, filetype"
    Then no ImportError is raised
```

## Implementation notes
- Use `opencv-python-headless` (not `opencv-python`) to avoid GUI dependencies in the container.
- Pin `Pydantic>=2.0,<3.0` and `pydantic-settings>=2.0,<3.0`.
- `python-magic` requires `libmagic` system library; ensure the Dockerfile installs `libmagic1` via `apt-get`.
- Include `filetype` as a pure-Python fallback per the L2 design contract for environments without libmagic.
- Python base image: `python:3.11-slim`.

## Definition of done
- [ ] Code reviewed and merged
- [ ] All Gherkin scenarios covered by automated tests
- [ ] Docker build completes successfully in CI
- [ ] `pip check` passes inside the built image
