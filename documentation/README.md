# Portfolio Planner Documentation

Welcome to the Portfolio Planner documentation. This directory contains comprehensive documentation for the entire system.

## Documentation Structure

### 📋 Overview Documents

- **[architecture-overview.md](./architecture-overview.md)** - High-level system architecture, technology stack, and design decisions
- **[project-capabilities.md](./project-capabilities.md)** - Current and planned features
- **[project-structure.md](./project-structure.md)** - File organization and component structure
- **[implementation-summary.md](./implementation-summary.md)** - Current implementation status and Phase 1 summary

### 🔧 Technical Documentation

- **[position-management.md](./position-management.md)** - Detailed position system design, database schema, and business rules
- **[schwab-integration.md](./schwab-integration.md)** - Schwab API integration guide, OAuth flow, and data transformation
- **[collaboration-architecture.md](./collaboration-architecture.md)** - Real-time collaboration system with WebSockets
- **[development-guide.md](./development-guide.md)** - Setup instructions, coding standards, and development workflows

### 🌐 Distributed Architecture

- **[../DISTRIBUTED_COLLABORATION_ARCHITECTURE.md](../DISTRIBUTED_COLLABORATION_ARCHITECTURE.md)** - Multi-tenant distributed architecture design
- **[../DISTRIBUTED_TESTING_GUIDE.md](../DISTRIBUTED_TESTING_GUIDE.md)** - Testing guide for distributed instances
- **[../collaboration-service/README.md](../collaboration-service/README.md)** - Collaboration Service documentation

### 🎯 Quick Start Guides

#### For Developers
1. Start with [development-guide.md](./development-guide.md) - Setup & Getting Started
2. Review [architecture-overview.md](./architecture-overview.md) - Understand the system
3. Reference [position-management.md](./position-management.md) - Core domain knowledge

#### For Architects
1. Read [architecture-overview.md](./architecture-overview.md) - System design
2. Review [position-management.md](./position-management.md) - Data models
3. Check [schwab-integration.md](./schwab-integration.md) - External integrations

#### For Product Owners
1. See [project-capabilities.md](./project-capabilities.md) - Current features
2. Reference [position-management.md](./position-management.md) - Position types and workflows

## Key Concepts

### Position Flavors
The system manages three distinct types of positions:
- **Actual** - Real positions synced from Schwab API (read-only)
- **Trade Ideas** - User-created planning positions (fully editable)
- **Shared** - Trade ideas shared by friends (view + comment)

### Technology Stack
- **Frontend**: React 18, Tailwind CSS, React Query
- **Backend**: Python FastAPI, SQLAlchemy
- **Database**: PostgreSQL
- **External API**: Schwab API (with OAuth 2.0)

### Current Development Phase
✅ **Phase 1**: Backend setup, user authentication, mock Schwab integration
⏳ **Phase 2**: Real Schwab API integration, account selection
🔮 **Phase 3**: Enhanced collaboration features
🔮 **Phase 4**: Advanced analytics and automation

## Document Maintenance

### Update Schedule
- **Weekly**: Project capabilities (as features are added)
- **As Needed**: Technical documentation (with code changes)
- **Quarterly**: Architecture overview (major design changes)

### Contributing to Documentation
1. Keep documentation in sync with code changes
2. Update relevant docs when adding features
3. Use markdown formatting consistently
4. Include code examples where helpful
5. Update "Last Updated" dates

### Documentation Standards
- Use clear, concise language
- Include code examples and diagrams
- Keep technical depth appropriate for audience
- Cross-reference related documents
- Use proper markdown formatting

## Related Resources

### External Documentation
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [React Docs](https://react.dev/)
- [Schwab API Docs](https://developer.schwab.com/)

### Repository Links
- [Backend Source](/backend)
- [Frontend Source](/frontend)
- [Reference Implementation](/ref)

## Questions or Feedback?

If you find documentation unclear or incomplete:
1. Check related documents (cross-references)
2. Review code comments in source files
3. Consult development team
4. Submit documentation improvement PR

---

**Documentation Version**: 1.0
**Last Updated**: 2025-10-25
**Maintained By**: Development Team

