"""
Remediation Executor — simulates running remediation scripts.

In production, this would SSH into servers, call cloud APIs,
or trigger Terraform/Ansible playbooks. For the demo, we simulate
execution with canary rollout stages.
"""

import asyncio
import datetime
import logging
import random

logger = logging.getLogger("itops.remediation")


class RemediationExecutor:
    """Simulates executing remediation scripts with canary rollout."""

    CANARY_STAGES = [
        ("canary_5", 5, "Deploying fix to 5% of fleet"),
        ("canary_25", 25, "Expanding to 25% of fleet"),
        ("canary_100", 100, "Rolling out to 100% of fleet"),
    ]

    async def execute_remediation(
        self,
        remediation_plan: dict,
        on_stage_update=None,
    ) -> dict:
        """
        Execute a remediation plan with canary rollout simulation.

        Args:
            remediation_plan: The plan from the Remediation Agent.
            on_stage_update: Optional async callback(stage, details) for progress.

        Returns:
            Execution result with logs.
        """
        steps = remediation_plan.get("steps", [])
        canary_compatible = remediation_plan.get("canary_compatible", False)
        execution_log = []
        success = True

        for step in steps:
            step_log = {
                "order": step.get("order", 0),
                "action": step.get("action", "unknown"),
                "action_type": step.get("action_type", "unknown"),
                "started_at": datetime.datetime.utcnow().isoformat(),
            }

            if canary_compatible:
                # Execute with canary stages
                for stage_name, percentage, description in self.CANARY_STAGES:
                    logger.info(f"Canary {stage_name}: {description}")
                    if on_stage_update:
                        await on_stage_update(stage_name, {
                            "step": step.get("order"),
                            "percentage": percentage,
                            "description": description,
                        })

                    # Simulate execution time
                    exec_time = step.get("estimated_duration_seconds", 10) / 3
                    await asyncio.sleep(min(exec_time, 3))  # Cap at 3s for demo

                    # Simulate validation
                    validation_passed = random.random() > 0.05  # 95% success rate

                    if not validation_passed:
                        logger.warning(f"Canary validation failed at {stage_name}")
                        step_log["failed_at_stage"] = stage_name
                        step_log["status"] = "rolled_back"
                        step_log["rollback_script"] = step.get("rollback_script", "N/A")
                        success = False
                        break
                else:
                    step_log["status"] = "completed"
            else:
                # Direct execution (no canary)
                await asyncio.sleep(min(step.get("estimated_duration_seconds", 5), 3))
                step_log["status"] = "completed"

            step_log["completed_at"] = datetime.datetime.utcnow().isoformat()
            execution_log.append(step_log)

            if not success:
                break

        return {
            "success": success,
            "execution_log": execution_log,
            "total_steps": len(steps),
            "completed_steps": sum(1 for s in execution_log if s.get("status") == "completed"),
            "completed_at": datetime.datetime.utcnow().isoformat(),
        }

    async def execute_rollback(self, remediation_plan: dict) -> dict:
        """Execute rollback scripts for a failed remediation."""
        steps = remediation_plan.get("steps", [])
        rollback_log = []

        for step in reversed(steps):
            rollback_script = step.get("rollback_script", "")
            if rollback_script:
                logger.info(f"Rolling back step {step.get('order')}: {step.get('action')}")
                await asyncio.sleep(1)  # Simulate
                rollback_log.append({
                    "order": step.get("order"),
                    "action": f"Rollback: {step.get('action')}",
                    "status": "completed",
                    "timestamp": datetime.datetime.utcnow().isoformat(),
                })

        return {
            "success": True,
            "rollback_log": rollback_log,
            "completed_at": datetime.datetime.utcnow().isoformat(),
        }


# Singleton
_executor: RemediationExecutor | None = None


def get_executor() -> RemediationExecutor:
    global _executor
    if _executor is None:
        _executor = RemediationExecutor()
    return _executor
