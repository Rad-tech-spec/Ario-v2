# Overview 
This application is a modular, custom AI assistant (chatbot) designed for Microsoft Teams. It orchestrates multiple agents *(e.g., VendorAgent, IngredientAgent,...)* using a centralized prompt engine. 

Built with extensibility and production-grade automation in mind, the assistant supports:

- 🔁 Multi-agent orchestration with schema-based routing
- 🧠 Passive engagement tracking and auto-tagging
- 🧩 Few-shot injection from high-rated examples
- 🛠️ Azure-hosted agent integration via OpenAI and AI Projects
- 💬 Seamless deployment into Teams via manifest.json

## Features
- **Agent Orchestrationz** 
Dynamically routes user queries to specialized agents using function calling and schema validation. 
- **Feedback-Aware Prompting**
Injects high-rated Q&A examples into the system prompt to reinforce helpful behavior.
- **Passive Learning Loop**
Detects implicit signals (e.g., follow-ups, “thanks”) and auto-tags responses as helpful.
- **Memory Per Thread/User**
Stores conversation history using scoped keys (conversationId/userId) for personalized context.
- **Azure Integration**
Supports OpenAI deployments and Azure-hosted agents with secure credential handling.
- **Teams Deployment**
Fully compatible with Microsoft Teams via manifest.json, supporting personal, team, and group chat scopes.

## Tech Stack
- Node.js / TypeScript / Bicept
- SQLite (via better-sqlite3)
- Microsoft Teams SDK
- Azure OpenAI + AI Projects
- Custom feedbackStore + engagement tracker

## Setup 
- Clone the repo and install dependencies:
`npm install`
- Configure your .env with Azure credentials:
`AZURE_OPENAI_KEY=...`
`AZURE_OPENAI_ENDPOINT=...`
`AZURE_OPENAI_DEPLOYMENT_NAME=...`
- Sideload the app into Teams using manifest.json.

## Architecture & Extensibilit

- [x] Function Calling (Implemented)
Uses OpenAI function calling to route user queries to specialized agents (VendorAgent, IngredientAgent) with schema validation and fallback logic.
- [x] Passive Feedback Loop (Implemented)
Tracks implicit engagement signals (e.g., follow-ups, “thanks”) and auto-tags helpful responses for prompt injection.
    - Explicit feedback via Teams buttons (like / dislike)
    - Implicit feedback via signal detection (thanks, follow-up)
    - Auto-tagging and storage in SQLite
    - Retrieval of high-rated examples for prompt injection
- [x] Retrieval-Augmented Generation (Implemented)
Future integration with vector-based RAG pipelines to enable grounded answers from vendor catalogs, ingredient databases, or internal documentation.
- [ ] FastAPI Integration (Planned)
Exposing orchestration logic via FastAPI endpoints (/ask, /feedback, /agent-status) for external systems, dashboards, or mobile clients.

## Future Enhancements
- ✅ TTL and pruning for long-term memory
- ✅ Agent-specific feedback tagging
- ✅ Similarity-based retrieval for answer reuse
- ✅ Dashboard for feedback analytics

## Authors
**Reza Alirezaei**
Dynamics 365 F&SCM Architect | Integrating AI & Cyber Security Solutions
LinkedIn: [linkedin.com/in/rezaal](www.inkedin.com/in/rezaal)

**Rad Eshghi**  
Backend & Cloud Developer  
Specializing in agent orchestration, modular SDKs, and feedback-aware systems  
GitHub: [@Rad-tech-spec](https://github.com/your-handle)  
LinkedIn: [linkedin.com/in/rad-eshghi](www.linkedin.com/in/rad-eshghi)