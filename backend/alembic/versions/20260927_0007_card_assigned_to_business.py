"""cards can be assigned to the business itself

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-27 00:00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("cards", sa.Column("assigned_to_business", sa.Boolean(), server_default=sa.text("false"),
                                     nullable=False))
    op.drop_constraint(op.f("ck_cards_single_assignee"), "cards", type_="check")
    op.create_check_constraint(
        op.f("ck_cards_single_assignee"), "cards",
        "(employee_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int + assigned_to_business::int <= 1",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_cards_single_assignee"), "cards", type_="check")
    op.execute("UPDATE cards SET assigned_to_business = false")
    op.create_check_constraint(op.f("ck_cards_single_assignee"), "cards", "employee_id IS NULL OR customer_id IS NULL")
    op.drop_column("cards", "assigned_to_business")
