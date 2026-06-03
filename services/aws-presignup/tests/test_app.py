from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from typing import Any


def _load_app_module() -> Any:
    app_path = Path(__file__).resolve().parents[1] / "src" / "app.py"
    spec = importlib.util.spec_from_file_location("aws_presignup_app", app_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load PreSignUp app module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PreSignUpHandlerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = _load_app_module()

    def test_complete_profile_attributes_are_allowed(self) -> None:
        event = {
            "request": {
                "userAttributes": {
                    "email": "user@example.com",
                    "given_name": "First",
                    "family_name": "Last",
                }
            }
        }

        self.assertIs(self.app.handler(event, None), event)

    def test_missing_profile_attributes_are_rejected(self) -> None:
        event = {
            "request": {
                "userAttributes": {
                    "email": "user@example.com",
                    "given_name": "",
                }
            }
        }

        with self.assertRaisesRegex(
            ValueError,
            "Missing required sign-up attributes: first name, last name",
        ):
            self.app.handler(event, None)


if __name__ == "__main__":
    unittest.main()
