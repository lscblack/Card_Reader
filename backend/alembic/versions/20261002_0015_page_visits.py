"""page visits

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-02 09:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0015'
down_revision: Union[str, None] = '0014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('page_visits',
    sa.Column('kind', sa.String(length=16), nullable=False),
    sa.Column('path', sa.String(length=300), nullable=False),
    sa.Column('business_id', sa.Uuid(), nullable=True),
    sa.Column('profile_id', sa.Uuid(), nullable=True),
    sa.Column('digital_card_id', sa.Uuid(), nullable=True),
    sa.Column('user_id', sa.Uuid(), nullable=True),
    sa.Column('visitor_hash', sa.String(length=32), nullable=True),
    sa.Column('referrer_host', sa.String(length=200), nullable=True),
    sa.Column('device_type', sa.String(length=16), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("kind IN ('site','support','business','personal')", name=op.f('ck_page_visits_kind')),
    sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name=op.f('fk_page_visits_business_id_businesses'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['digital_card_id'], ['digital_cards.id'], name=op.f('fk_page_visits_digital_card_id_digital_cards'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['profile_id'], ['profiles.id'], name=op.f('fk_page_visits_profile_id_profiles'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_page_visits_user_id_users'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_page_visits'))
    )
    op.create_index('ix_page_visits_kind_created', 'page_visits', ['kind', 'created_at'], unique=False)
    op.create_index('ix_page_visits_business_created', 'page_visits', ['business_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_page_visits_digital_card_id'), 'page_visits', ['digital_card_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_page_visits_digital_card_id'), table_name='page_visits')
    op.drop_index('ix_page_visits_business_created', table_name='page_visits')
    op.drop_index('ix_page_visits_kind_created', table_name='page_visits')
    op.drop_table('page_visits')
