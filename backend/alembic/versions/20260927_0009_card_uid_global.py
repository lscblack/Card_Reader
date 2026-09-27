"""card uid unique across the platform

A physical chip (UID) may belong to only one live card, whichever business registered it.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-27 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0009'
down_revision: Union[str, None] = '0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    dupes = op.get_bind().execute(sa.text(
        "SELECT uid, count(*) FROM cards WHERE uid IS NOT NULL AND deleted_at IS NULL GROUP BY uid HAVING count(*) > 1"
    )).fetchall()
    if dupes:
        listed = ", ".join(f"{row[0]} ({row[1]} cards)" for row in dupes[:20])
        raise RuntimeError(
            f"{len(dupes)} chip UIDs are registered on more than one live card: {listed}. "
            "Delete or clear the UID on the extra cards, then run the migration again."
        )
    op.drop_index('uq_cards_business_uid', table_name='cards')
    op.create_index('uq_cards_uid', 'cards', ['uid'], unique=True,
                    postgresql_where=sa.text('uid IS NOT NULL AND deleted_at IS NULL'))


def downgrade() -> None:
    op.drop_index('uq_cards_uid', table_name='cards')
    op.create_index('uq_cards_business_uid', 'cards', ['business_id', 'uid'], unique=True,
                    postgresql_where=sa.text('uid IS NOT NULL AND deleted_at IS NULL'))
