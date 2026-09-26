from fastapi import APIRouter

from app.api.v1.routes import (
    account,
    admin,
    admin_console,
    admin_part3,
    api_keys,
    applications,
    auth,
    businesses,
    cards,
    device_api,
    devices,
    events,
    forms,
    health,
    live_notifications,
    releases,
    pairing,
    personal,
    people,
    profiles,
    public,
    request_logs,
    sandbox,
    team,
)

api_router = APIRouter(prefix="/api/v1")
for module in (health, auth, account, applications, api_keys, devices, events, admin, admin_console, admin_part3, pairing,
               device_api, request_logs, sandbox, businesses, people, cards, profiles, forms, team, public):
    api_router.include_router(module.router)
api_router.include_router(team.public_router)
api_router.include_router(profiles.public_router)
api_router.include_router(live_notifications.router)
api_router.include_router(personal.router)
api_router.include_router(personal.public_router)
api_router.include_router(releases.router)
api_router.include_router(releases.admin_router)

# Root-level public routes (no /api/v1): card taps and the sandbox receiver.
root_router = APIRouter()
root_router.include_router(public.root_router)
root_router.include_router(releases.root_router)
