"""Employees & customers (Part 2 §B3)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy import func, or_, select

from app.api.deps import BusinessContext, ClientDep, PaginationDep, SessionDep, business_permission
from app.core.config import settings
from app.core.errors import not_found
from app.models import Customer, Employee, Profile
from app.schemas.business import (
    CustomerIn,
    CustomerOut,
    CustomerUpdateIn,
    EmployeeIn,
    EmployeeOut,
    EmployeeUpdateIn,
)
from app.schemas.common import Page
from app.services import audit, media
from app.services import business as biz
from app.services.business_serializers import customers_out, employees_out

router = APIRouter(prefix="/businesses/{business_id}", tags=["Employees & customers"])

View = Annotated[BusinessContext, Depends(business_permission("business.view"))]
Manage = Annotated[BusinessContext, Depends(business_permission("people.manage"))]


def _employee_sections(e: Employee) -> list[dict]:  # type: ignore[type-arg]
    sections: list[dict] = [{"type": "contact", "phone": e.phone, "email": e.email, "website": None,  # type: ignore[type-arg]
                             "address": None}]
    if e.social_links:
        sections.append({"type": "social", "links": list(e.social_links)})
    return sections


async def _employee_slug(session: SessionDep, business_id: uuid.UUID, name: str,
                         exclude_employee: uuid.UUID | None = None) -> str:
    base = biz.slugify(name, 56) or "employee"
    candidate = base
    for i in range(2, 500):
        e_taken = (await session.execute(select(Employee.id).where(
            Employee.business_id == business_id, Employee.slug == candidate,
            *([Employee.id != exclude_employee] if exclude_employee else [])))).first()
        p_taken = (await session.execute(select(Profile.id).where(
            Profile.business_id == business_id, Profile.slug == candidate, Profile.deleted_at.is_(None),
            *([Profile.employee_id.is_distinct_from(exclude_employee)] if exclude_employee else [])))).first()
        if not e_taken and not p_taken:
            return candidate
        candidate = f"{base}-{i}"
    return f"{base}-{uuid.uuid4().hex[:6]}"


async def _get_employee(session: SessionDep, business_id: uuid.UUID, employee_id: uuid.UUID) -> Employee:
    e = await session.get(Employee, employee_id)
    if e is None or e.business_id != business_id:
        raise not_found("Employee")
    return e


async def _one_employee(session: SessionDep, ctx: BusinessContext, e: Employee) -> EmployeeOut:
    return (await employees_out(session, ctx.business, [e]))[0]


# ── Employees ───────────────────────────────────────────────────────────
@router.get("/employees", response_model=Page[EmployeeOut], summary="List employees")
async def list_employees(ctx: View, session: SessionDep, pagination: PaginationDep,
                         q: str | None = Query(default=None, max_length=100),
                         status: Literal["active", "inactive"] | None = None,
                         department: str | None = Query(default=None, max_length=120)) -> Page[EmployeeOut]:
    conds = [Employee.business_id == ctx.business.id]
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like), Employee.email.ilike(like),
                         Employee.phone.ilike(like), Employee.position.ilike(like),
                         func.concat(Employee.first_name, " ", Employee.last_name).ilike(like)))
    if status:
        conds.append(Employee.status == status)
    if department:
        conds.append(Employee.department == department)
    total = (await session.execute(select(func.count()).select_from(Employee).where(*conds))).scalar_one()
    rows = list((await session.execute(select(Employee).where(*conds).order_by(Employee.first_name, Employee.id)
                                       .offset(pagination.offset).limit(pagination.page_size))).scalars())
    return Page[EmployeeOut](items=await employees_out(session, ctx.business, rows), total=total,
                             page=pagination.page, page_size=pagination.page_size)


@router.post("/employees", status_code=201, response_model=EmployeeOut, summary="Add an employee")
async def create_employee(body: EmployeeIn, ctx: Manage, session: SessionDep, client: ClientDep) -> EmployeeOut:
    e = Employee(
        business_id=ctx.business.id, first_name=body.first_name.strip(), last_name=body.last_name.strip(),
        position=body.position, department=body.department, phone=body.phone, email=body.email,
        social_links=[s.model_dump() for s in body.social_links], status="active", total_taps=0,
        slug=await _employee_slug(session, ctx.business.id, f"{body.first_name} {body.last_name}"),
    )
    session.add(e)
    await session.flush()
    session.add(Profile(business_id=ctx.business.id, type="employee", slug=e.slug, title=e.full_name,
                        employee_id=e.id, published=True if body.profile_published is None else body.profile_published,
                        theme={"accent": "#b91c1c"}, sections=_employee_sections(e)))
    audit.record(session, action="employee.create", user_id=ctx.user.id, client=client, resource_type="employee",
                 resource_id=e.id, metadata={"name": e.full_name})
    await session.commit()
    return await _one_employee(session, ctx, e)


@router.get("/employees/{employee_id}", response_model=EmployeeOut, summary="Get an employee")
async def get_employee(employee_id: uuid.UUID, ctx: View, session: SessionDep) -> EmployeeOut:
    return await _one_employee(session, ctx, await _get_employee(session, ctx.business.id, employee_id))


@router.patch("/employees/{employee_id}", response_model=EmployeeOut, summary="Update an employee")
async def update_employee(employee_id: uuid.UUID, body: EmployeeUpdateIn, ctx: Manage, session: SessionDep,
                          client: ClientDep) -> EmployeeOut:
    e = await _get_employee(session, ctx.business.id, employee_id)
    data = body.model_dump(exclude_unset=True)
    for field in ("first_name", "last_name", "position", "department", "phone", "email"):
        if field in data:
            value = data[field]
            setattr(e, field, value.strip() if isinstance(value, str) and field.endswith("name") else value)
    if body.social_links is not None:
        e.social_links = [s.model_dump() for s in body.social_links]
    if body.profile_published is not None:
        profile = (await session.execute(select(Profile).where(
            Profile.employee_id == e.id, Profile.deleted_at.is_(None)))).scalar_one_or_none()
        if profile is not None:
            profile.published = body.profile_published
    audit.record(session, action="employee.update", user_id=ctx.user.id, client=client, resource_type="employee",
                 resource_id=e.id, metadata={"fields": sorted(data)})
    await session.commit()
    return await _one_employee(session, ctx, e)


@router.delete("/employees/{employee_id}", status_code=204, summary="Delete an employee (cards become unassigned)")
async def delete_employee(employee_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> Response:
    e = await _get_employee(session, ctx.business.id, employee_id)
    audit.record(session, action="employee.delete", user_id=ctx.user.id, client=client, resource_type="employee",
                 resource_id=e.id, metadata={"name": e.full_name})
    await session.delete(e)
    await session.commit()
    return Response(status_code=204)


async def _set_status(employee_id: uuid.UUID, ctx: BusinessContext, session: SessionDep, client: ClientDep,
                      status: str) -> EmployeeOut:
    e = await _get_employee(session, ctx.business.id, employee_id)
    if e.status != status:
        e.status = status
        audit.record(session, action=f"employee.{'activate' if status == 'active' else 'deactivate'}",
                     user_id=ctx.user.id, client=client, resource_type="employee", resource_id=e.id,
                     metadata={"name": e.full_name})
        await session.commit()
    return await _one_employee(session, ctx, e)


@router.post("/employees/{employee_id}/deactivate", response_model=EmployeeOut,
             summary="Deactivate (cards → inactive_owner, profile hidden immediately)")
async def deactivate_employee(employee_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> EmployeeOut:
    return await _set_status(employee_id, ctx, session, client, "inactive")


@router.post("/employees/{employee_id}/activate", response_model=EmployeeOut, summary="Reactivate (restores cards/profile)")
async def activate_employee(employee_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> EmployeeOut:
    return await _set_status(employee_id, ctx, session, client, "active")


@router.post("/employees/{employee_id}/photo", response_model=EmployeeOut, summary="Upload a photo (PNG/JPEG/WebP ≤ 2 MB)")
async def upload_photo(employee_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep,
                       file: UploadFile = File(...)) -> EmployeeOut:
    e = await _get_employee(session, ctx.business.id, employee_id)
    data = await file.read(settings.MEDIA_MAX_UPLOAD_BYTES + 1)
    path = media.save_image(data, f"businesses/{ctx.business.id}/employees", str(e.id))
    old, e.photo_path = e.photo_path, path
    audit.record(session, action="employee.photo_update", user_id=ctx.user.id, client=client,
                 resource_type="employee", resource_id=e.id)
    await session.commit()
    media.delete_file(old)
    return await _one_employee(session, ctx, e)


# ── Customers ───────────────────────────────────────────────────────────
async def _get_customer(session: SessionDep, business_id: uuid.UUID, customer_id: uuid.UUID) -> Customer:
    c = await session.get(Customer, customer_id)
    if c is None or c.business_id != business_id:
        raise not_found("Customer")
    return c


@router.get("/customers", response_model=Page[CustomerOut], summary="List customers")
async def list_customers(ctx: View, session: SessionDep, pagination: PaginationDep,
                         q: str | None = Query(default=None, max_length=100),
                         status: Literal["active", "inactive"] | None = None) -> Page[CustomerOut]:
    conds = [Customer.business_id == ctx.business.id]
    if q:
        like = f"%{q.strip()}%"
        conds.append(or_(Customer.full_name.ilike(like), Customer.email.ilike(like), Customer.phone.ilike(like),
                         Customer.company.ilike(like)))
    if status:
        conds.append(Customer.status == status)
    total = (await session.execute(select(func.count()).select_from(Customer).where(*conds))).scalar_one()
    rows = list((await session.execute(select(Customer).where(*conds).order_by(Customer.full_name, Customer.id)
                                       .offset(pagination.offset).limit(pagination.page_size))).scalars())
    return Page[CustomerOut](items=await customers_out(session, ctx.business, rows), total=total,
                             page=pagination.page, page_size=pagination.page_size)


@router.post("/customers", status_code=201, response_model=CustomerOut, summary="Add a customer")
async def create_customer(body: CustomerIn, ctx: Manage, session: SessionDep, client: ClientDep) -> CustomerOut:
    c = Customer(business_id=ctx.business.id, full_name=body.full_name.strip(), email=body.email, phone=body.phone,
                 company=body.company, notes=body.notes, tags=[t.strip()[:40] for t in body.tags if t.strip()],
                 status=body.status, total_taps=0)
    session.add(c)
    await session.flush()
    audit.record(session, action="customer.create", user_id=ctx.user.id, client=client, resource_type="customer",
                 resource_id=c.id, metadata={"name": c.full_name})
    await session.commit()
    return (await customers_out(session, ctx.business, [c]))[0]


@router.get("/customers/{customer_id}", response_model=CustomerOut, summary="Get a customer")
async def get_customer(customer_id: uuid.UUID, ctx: View, session: SessionDep) -> CustomerOut:
    return (await customers_out(session, ctx.business, [await _get_customer(session, ctx.business.id, customer_id)]))[0]


@router.patch("/customers/{customer_id}", response_model=CustomerOut, summary="Update a customer")
async def update_customer(customer_id: uuid.UUID, body: CustomerUpdateIn, ctx: Manage, session: SessionDep,
                          client: ClientDep) -> CustomerOut:
    c = await _get_customer(session, ctx.business.id, customer_id)
    data = body.model_dump(exclude_unset=True)
    for field in ("full_name", "email", "phone", "company", "notes", "status"):
        if field in data and (data[field] is not None or field not in ("full_name", "status")):
            setattr(c, field, data[field])
    if body.tags is not None:
        c.tags = [t.strip()[:40] for t in body.tags if t.strip()]
    audit.record(session, action="customer.update", user_id=ctx.user.id, client=client, resource_type="customer",
                 resource_id=c.id, metadata={"fields": sorted(data)})
    await session.commit()
    return (await customers_out(session, ctx.business, [c]))[0]


@router.delete("/customers/{customer_id}", status_code=204, summary="Delete a customer")
async def delete_customer(customer_id: uuid.UUID, ctx: Manage, session: SessionDep, client: ClientDep) -> Response:
    c = await _get_customer(session, ctx.business.id, customer_id)
    audit.record(session, action="customer.delete", user_id=ctx.user.id, client=client, resource_type="customer",
                 resource_id=c.id, metadata={"name": c.full_name})
    await session.delete(c)
    await session.commit()
    return Response(status_code=204)
