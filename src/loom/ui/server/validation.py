"""Pipeline validation against task schemas."""

from typing import Any

from .models import ValidationWarning


def validate_pipeline(
    yaml_data: dict[str, Any], task_schemas: dict[str, Any]
) -> list[ValidationWarning]:
    """Validate pipeline configuration against task schemas.

    Checks:
    1. Task inputs/outputs have types defined in schema
    2. Pipeline uses typed data nodes where appropriate
    3. Warns about missing type annotations
    """
    warnings: list[ValidationWarning] = []
    pipeline = yaml_data.get("pipeline", [])
    data_section = yaml_data.get("data", {})
    variables = yaml_data.get("variables", {})

    for step in pipeline:
        step_name = step.get("name", "unknown")
        task_path = step.get("task", "")
        task_schema = task_schemas.get(task_path)

        if not task_schema:
            continue  # No schema to validate against

        # Check inputs
        for input_name, input_ref in step.get("inputs", {}).items():
            input_schema = task_schema.get("inputs", {}).get(input_name, {})
            expected_type = input_schema.get("type")

            if expected_type:
                # Task expects a typed input
                if input_ref.startswith("$"):
                    ref_name = input_ref[1:]
                    if ref_name in variables and ref_name not in data_section:
                        # Connected to untyped variable, but task expects type
                        warnings.append(
                            ValidationWarning(
                                level="info",
                                message=f"Input '{input_name}' expects type '{expected_type}' but is connected to untyped variable '${ref_name}'. Consider using a typed data node.",
                                step=step_name,
                                input_output=input_name,
                            )
                        )

        # Check outputs
        for output_name, output_ref in step.get("outputs", {}).items():
            output_schema = task_schema.get("outputs", {}).get(output_name, {})
            expected_type = output_schema.get("type")

            if expected_type:
                # Task produces a typed output
                if output_ref.startswith("$"):
                    ref_name = output_ref[1:]
                    if ref_name in variables and ref_name not in data_section:
                        # Connected to untyped variable, but task produces typed output
                        warnings.append(
                            ValidationWarning(
                                level="info",
                                message=f"Output '{output_name}' produces type '{expected_type}' but is connected to untyped variable '${ref_name}'. Consider using a typed data node.",
                                step=step_name,
                                input_output=output_name,
                            )
                        )

    return warnings
