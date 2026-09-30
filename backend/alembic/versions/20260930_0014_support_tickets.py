"""support tickets

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-30 18:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0014'
down_revision: Union[str, None] = '0013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('support_tickets',
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('email', sa.String(length=320), nullable=False),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('category', sa.String(length=16), nullable=False),
    sa.Column('subject', sa.String(length=200), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('admin_note', sa.Text(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('open','in_progress','resolved')", name=op.f('ck_support_tickets_status')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_support_tickets_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_support_tickets'))
    )
    op.create_index(op.f('ix_support_tickets_user_id'), 'support_tickets', ['user_id'], unique=False)
    op.create_index(op.f('ix_support_tickets_status'), 'support_tickets', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_support_tickets_status'), table_name='support_tickets')
    op.drop_index(op.f('ix_support_tickets_user_id'), table_name='support_tickets')
    op.drop_table('support_tickets')
