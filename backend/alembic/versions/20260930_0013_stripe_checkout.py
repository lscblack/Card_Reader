"""stripe checkout: checkout sessions, stripe customer/subscription ids

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-30 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0013'
down_revision: Union[str, None] = '0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('stripe_customer_id', sa.String(length=255), nullable=True))
    op.add_column('businesses', sa.Column('stripe_customer_id', sa.String(length=255), nullable=True))
    op.add_column('businesses', sa.Column('stripe_subscription_id', sa.String(length=255), nullable=True))
    op.create_table('checkout_sessions',
    sa.Column('stripe_session_id', sa.String(length=255), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('business_id', sa.Uuid(), nullable=True),
    sa.Column('plan_code', sa.String(length=32), nullable=False),
    sa.Column('billing_interval', sa.String(length=8), nullable=False),
    sa.Column('amount_cents', sa.Integer(), nullable=False),
    sa.Column('currency', sa.String(length=3), nullable=False),
    sa.Column('promotion_code', sa.String(length=32), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('stripe_subscription_id', sa.String(length=255), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('open','complete','expired')", name=op.f('ck_checkout_sessions_status')),
    sa.CheckConstraint("billing_interval IN ('month','year')", name=op.f('ck_checkout_sessions_billing_interval')),
    sa.ForeignKeyConstraint(['business_id'], ['businesses.id'], name=op.f('fk_checkout_sessions_business_id_businesses'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_checkout_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_checkout_sessions')),
    sa.UniqueConstraint('stripe_session_id', name=op.f('uq_checkout_sessions_stripe_session_id'))
    )
    op.create_index(op.f('ix_checkout_sessions_user_id'), 'checkout_sessions', ['user_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_checkout_sessions_user_id'), table_name='checkout_sessions')
    op.drop_table('checkout_sessions')
    op.drop_column('businesses', 'stripe_subscription_id')
    op.drop_column('businesses', 'stripe_customer_id')
    op.drop_column('users', 'stripe_customer_id')
