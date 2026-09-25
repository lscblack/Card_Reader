import type { BusinessRole, Permission } from '../api/types'

/** Role → permission table from contract B1 (fallback when `/me` is unavailable; backend enforces). */
export const ROLE_PERMISSIONS: Record<BusinessRole, Permission[]> = {
  owner: [
    'business.view', 'cards.manage', 'people.manage', 'profiles.manage', 'devices.manage', 'analytics.view',
    'api.view', 'api.manage', 'team.manage', 'settings.manage', 'billing.manage', 'business.delete', 'ownership.transfer',
  ],
  admin: [
    'business.view', 'cards.manage', 'people.manage', 'profiles.manage', 'devices.manage', 'analytics.view',
    'api.view', 'api.manage', 'team.manage', 'settings.manage',
  ],
  manager: ['business.view', 'cards.manage', 'people.manage', 'profiles.manage', 'devices.manage', 'analytics.view'],
  staff: ['business.view'],
}

export const ROLES: BusinessRole[] = ['owner', 'admin', 'manager', 'staff']

export const ROLE_LABELS: Record<BusinessRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
}

export const ROLE_DESCRIPTIONS: Record<BusinessRole, string> = {
  owner: 'Full access, including billing, deleting the business and transferring ownership.',
  admin: 'Manage everything except billing and ownership. Can manage non-owner team members.',
  manager: 'Manage cards, tags, people, profiles and devices, and view analytics.',
  staff: 'Read-only access to the business: cards, people, events and profiles.',
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  'business.view': 'View business',
  'cards.manage': 'Manage cards, tags & actions',
  'people.manage': 'Manage employees & customers',
  'profiles.manage': 'Manage public profiles',
  'devices.manage': 'Manage devices',
  'analytics.view': 'View analytics',
  'api.view': 'View API & integrations',
  'api.manage': 'Manage API keys, endpoints & webhooks',
  'team.manage': 'Manage team members',
  'settings.manage': 'Manage business settings',
  'billing.manage': 'Manage billing',
  'business.delete': 'Delete business',
  'ownership.transfer': 'Transfer ownership',
}

/** Owners/admins can grant these as extra permissions (never billing/delete/transfer). */
export const GRANTABLE_PERMISSIONS: Permission[] = [
  'cards.manage', 'people.manage', 'profiles.manage', 'devices.manage', 'analytics.view',
  'api.view', 'api.manage', 'team.manage', 'settings.manage',
]
