# Portfolio Planner Documentation

Welcome to the Portfolio Planner documentation. This directory contains comprehensive documentation for the entire system.

## 📚 Documentation Index

### 🚀 Getting Started

**New to the project? Start here:**

1. **[development-guide.md](./development-guide.md)** - Setup instructions, environment configuration, and first steps
2. **[DISTRIBUTED_QUICK_START.md](./DISTRIBUTED_QUICK_START.md)** - Quick start guide for running distributed instances
3. **[schwab-api-setup.md](./schwab-api-setup.md)** - How to set up Schwab API credentials

---

### 🏗️ Architecture & Design

**System design and architectural decisions:**

- **[architecture-overview.md](./architecture-overview.md)** - High-level system architecture and technology stack
- **[project-structure.md](./project-structure.md)** - File organization and component structure
- **[DISTRIBUTED_COLLABORATION_ARCHITECTURE.md](./DISTRIBUTED_COLLABORATION_ARCHITECTURE.md)** - Multi-tenant distributed architecture design
- **[collaboration-architecture.md](./collaboration-architecture.md)** - Real-time WebSocket collaboration system
- **[DISTRIBUTED_ARCHITECTURE_RUNTIME.md](./DISTRIBUTED_ARCHITECTURE_RUNTIME.md)** - Runtime configuration for distributed mode

---

### 💼 Core Features

**Position Management:**

- **[position-management.md](./position-management.md)** - Position system design, database schema, and business rules
- **[POSITION_STATUS_AND_SIGNATURES.md](./POSITION_STATUS_AND_SIGNATURES.md)** - How position status and signatures work (essential reading)
- **[STRATEGY_LOCKING_DESIGN.md](./STRATEGY_LOCKING_DESIGN.md)** - Design for manual strategy assignment and locking
- **[STRATEGY_LOCKING_FLOWS.md](./STRATEGY_LOCKING_FLOWS.md)** - Visual flows for strategy locking behavior
- **[MANUAL_STRATEGY_ASSIGNMENT.md](./MANUAL_STRATEGY_ASSIGNMENT.md)** - User guide for manual strategy management
- **[POSITION_GROUPING_FIXES.md](./POSITION_GROUPING_FIXES.md)** - Position grouping logic and fixes
- **[STRATEGY_GROUPS_FIX.md](./STRATEGY_GROUPS_FIX.md)** - Fix for position signature stability and custom strategy groups

**Schwab Integration:**

- **[schwab-integration.md](./schwab-integration.md)** - Schwab API integration guide, OAuth flow, and data transformation
- **[schwab-api-setup.md](./schwab-api-setup.md)** - Step-by-step Schwab API setup

**Collaboration:**

- **[collaboration-features.md](./collaboration-features.md)** - Real-time collaboration features overview
- **[COLLABORATION_IMPLEMENTATION_SUMMARY.md](./COLLABORATION_IMPLEMENTATION_SUMMARY.md)** - Implementation details for collaboration

---

### 🧪 Testing & Debugging

**Testing guides:**

- **[DISTRIBUTED_TESTING_GUIDE.md](./DISTRIBUTED_TESTING_GUIDE.md)** - Testing guide for distributed instances
- **[COLLABORATION_TESTING_GUIDE.md](./COLLABORATION_TESTING_GUIDE.md)** - Testing collaboration features
- **[SHARING_DEBUG_GUIDE.md](./SHARING_DEBUG_GUIDE.md)** - Debugging trade idea sharing

**Debug & Troubleshooting:**

- **[COLLABORATION_DEBUG_PLAN.md](./COLLABORATION_DEBUG_PLAN.md)** - Systematic debugging plan for collaboration
- **[COLLABORATION_FIX_SUMMARY.md](./COLLABORATION_FIX_SUMMARY.md)** - Summary of collaboration fixes

---

### 🔧 Configuration & Operations

**Configuration:**

- **[CONFIGURATION_MANAGEMENT.md](./CONFIGURATION_MANAGEMENT.md)** - Best practices for managing configuration files
- **[STARTUP_CONSISTENCY.md](./STARTUP_CONSISTENCY.md)** - Startup script enhancements for consistency

**Security:**

- **[SECURITY_INCIDENT.md](./SECURITY_INCIDENT.md)** - Security incident documentation and resolution
- **[GIT_CLEANUP_COMPLETE.md](./GIT_CLEANUP_COMPLETE.md)** - Git history cleanup for sensitive files

---

### 📋 Implementation Status

**Project progress and summaries:**

- **[project-capabilities.md](./project-capabilities.md)** - Current and planned features
- **[implementation-summary.md](./implementation-summary.md)** - Phase 1 implementation summary
- **[IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md)** - Complete distributed collaboration implementation summary
- **[DISTRIBUTED_IMPLEMENTATION_SUMMARY.md](./DISTRIBUTED_IMPLEMENTATION_SUMMARY.md)** - Distributed architecture implementation details
- **[STRATEGY_LOCKING_IMPLEMENTATION.md](./STRATEGY_LOCKING_IMPLEMENTATION.md)** - Strategy locking implementation guide
- **[FIXES_SUMMARY.md](./FIXES_SUMMARY.md)** - Summary of all fixes and improvements

---

### 🐛 Issue Resolution

**Documented fixes and improvements:**

- **[STRATEGY_GROUPS_FIX.md](./STRATEGY_GROUPS_FIX.md)** - Fix for unallocated strategy group disappearing (position signature stability)
- **[POSITION_GROUPING_FIXES.md](./POSITION_GROUPING_FIXES.md)** - Fixes for position grouping issues
- **[USER_ISOLATION_FIX.md](./USER_ISOLATION_FIX.md)** - User data isolation fixes
- **[TAGGING_FOR_RECIPIENTS.md](./TAGGING_FOR_RECIPIENTS.md)** - Recipient tagging improvements

---

### 📝 Session Notes

**Development session documentation:**

- **[session-2025-10-29.md](./session-2025-10-29.md)** - Development session notes from October 29, 2025

---

## 🎯 Quick Start Paths

### For Developers (First Time Setup)
1. **[development-guide.md](./development-guide.md)** - Setup & Getting Started
2. **[architecture-overview.md](./architecture-overview.md)** - Understand the system
3. **[position-management.md](./position-management.md)** - Core domain knowledge
4. **[schwab-api-setup.md](./schwab-api-setup.md)** - Configure Schwab API

### For Understanding Strategy Management
1. **[STRATEGY_LOCKING_DESIGN.md](./STRATEGY_LOCKING_DESIGN.md)** - Design and concepts
2. **[MANUAL_STRATEGY_ASSIGNMENT.md](./MANUAL_STRATEGY_ASSIGNMENT.md)** - User guide
3. **[STRATEGY_GROUPS_FIX.md](./STRATEGY_GROUPS_FIX.md)** - Recent fixes and testing

### For Running Distributed Mode
1. **[DISTRIBUTED_QUICK_START.md](./DISTRIBUTED_QUICK_START.md)** - Quick start guide
2. **[DISTRIBUTED_COLLABORATION_ARCHITECTURE.md](./DISTRIBUTED_COLLABORATION_ARCHITECTURE.md)** - Architecture
3. **[DISTRIBUTED_TESTING_GUIDE.md](./DISTRIBUTED_TESTING_GUIDE.md)** - Testing
4. **[CONFIGURATION_MANAGEMENT.md](./CONFIGURATION_MANAGEMENT.md)** - Configuration best practices

### For Troubleshooting Issues
1. Check **Issue Resolution** section above for known fixes
2. Review **Testing & Debugging** guides
3. Consult **[FIXES_SUMMARY.md](./FIXES_SUMMARY.md)** for historical context

---

## 🔑 Key Concepts

### Position Flavors
The system manages three distinct types of positions:
- **Actual** - Real positions synced from Schwab API (read-only, but strategy can be locked manually)
- **Trade Ideas** - User-created planning positions (fully editable)
- **Shared** - Trade ideas shared by friends (view + comment)

### Strategy Management
- **Auto-Detected Strategies** - Automatically grouped from Schwab positions (covered_call, vertical_spread, long_stock, etc.)
- **Custom Strategies** - User-defined groups (unallocated, wheel_strategy, iron_condor, etc.)
- **Strategy Locking** - Manual assignment that persists across syncs using position signatures

### Position Signatures
- **Stable cryptographic signatures** based on position structure (strikes, expirations, symbol, account)
- **Does NOT include** quantities or prices (which change constantly)
- **Purpose** - Reliably match positions across syncs even when market data changes

### Architecture Modes
- **Single-Instance Mode** - One frontend + one backend (default)
- **Distributed Mode** - Multiple independent instances collaborating via central service

---

## 🛠️ Technology Stack

### Frontend
- **React 18** - UI framework
- **Tailwind CSS** - Styling
- **React Query** - Server state management
- **Socket.io Client** - Real-time collaboration
- **Axios** - HTTP client

### Backend
- **Python 3.11+** - Runtime
- **FastAPI** - Web framework
- **SQLAlchemy** - ORM
- **Alembic** - Database migrations
- **Socket.io Server** - WebSocket collaboration
- **python-socketio** - Async client for distributed mode

### Collaboration Service
- **Node.js** - Runtime
- **Express** - Web framework
- **Socket.io** - WebSocket relay

### Database
- **SQLite** - Development (default)
- **PostgreSQL** - Production (recommended)

### External APIs
- **Schwab API** - OAuth 2.0 authenticated brokerage integration

---

## 📐 Development Phases

### ✅ Phase 1 - Complete
- Backend setup with FastAPI
- User authentication
- Mock Schwab integration
- Position management (3 flavors)
- Real-time collaboration (WebSocket)

### ✅ Phase 2 - Complete
- Real Schwab API integration
- OAuth 2.0 authentication
- Position syncing
- Strategy grouping
- Manual strategy assignment

### ✅ Phase 3 - Complete
- Distributed architecture
- Central collaboration service
- Multi-tenant support
- Strategy locking with position signatures
- Custom strategy groups

### 🔜 Phase 4 - Planned
- Advanced analytics
- Automated strategy detection
- Performance optimization
- Enhanced UI/UX

---

## 📝 Document Maintenance

### Update Guidelines
- **Keep in sync** - Update documentation with code changes
- **Link related docs** - Cross-reference for context
- **Include examples** - Code snippets, commands, screenshots
- **Date updates** - Note when documents are significantly changed

### Documentation Standards
- Use clear, concise language
- Include practical examples
- Keep technical depth appropriate for audience
- Use proper markdown formatting
- Add `---` separators between major sections

### When to Create New Documentation
- New feature implementation
- Architecture changes
- Bug fixes with broader implications
- Configuration changes
- Security incidents

---

## 🔗 Related Resources

### External Documentation
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [React Docs](https://react.dev/)
- [Schwab API Docs](https://developer.schwab.com/)
- [Socket.io Docs](https://socket.io/docs/)
- [SQLAlchemy Docs](https://docs.sqlalchemy.org/)

### Repository Structure
```
/backend              - Python FastAPI backend
/frontend             - React frontend
/collaboration-service - Node.js WebSocket relay
/documentation        - You are here!
/ref                  - Reference implementations
```

---

## ❓ Questions or Feedback?

If you find documentation unclear or incomplete:
1. Check **cross-references** in the document
2. Review **related documents** in the same category
3. Search for **specific topics** using your editor
4. Check **code comments** in source files
5. Consult the development team

---

**Documentation Version**: 2.0  
**Last Updated**: November 3, 2025  
**Maintained By**: Development Team  
**Total Documents**: 37

