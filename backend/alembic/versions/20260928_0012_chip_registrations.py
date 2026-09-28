"""chip registrations: physical cards registered to a personal digital card or a developer application

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-28 09:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0012'
down_revision: Union[str, None] = '0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('chip_registrations',
    sa.Column('uid', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('digital_card_id', sa.Uuid(), nullable=True),
    sa.Column('application_id', sa.Uuid(), nullable=True),
    sa.Column('label', sa.String(length=120), nullable=True),
    sa.Column('note', sa.String(length=500), nullable=True),
    sa.Column('taps', sa.Integer(), server_default='0', nullable=False),
    sa.Column('last_tap_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('(digital_card_id IS NOT NULL)::int + (application_id IS NOT NULL)::int = 1', name=op.f('ck_chip_registrations_single_target')),
    sa.ForeignKeyConstraint(['application_id'], ['applications.id'], name=op.f('fk_chip_registrations_application_id_applications'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['digital_card_id'], ['digital_cards.id'], name=op.f('fk_chip_registrations_digital_card_id_digital_cards'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_chip_registrations_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_chip_registrations'))
    )
    op.create_index('uq_chip_registrations_uid', 'chip_registrations', ['uid'], unique=True)
    op.create_index('ix_chip_registrations_user', 'chip_registrations', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_chip_registrations_application', 'chip_registrations', ['application_id', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_chip_registrations_application', table_name='chip_registrations')
    op.drop_index('ix_chip_registrations_user', table_name='chip_registrations')
    op.drop_index('uq_chip_registrations_uid', table_name='chip_registrations')
    op.drop_table('chip_registrations')
