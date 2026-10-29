<p align="center">
  <a href="https://interaone.app">
    <img width="120" alt="InteraOne" src="https://avatars.githubusercontent.com/u/222506196?s=200&v=4">
  </a>
</p>

<h2 align="center">InteraOne</h2>

<p align="center">
  <b>The open source, agentic alternative to Intercom & Zendesk</b>
  <br/>
  <sub>Intercom charges $0.99/resolution. Zendesk charges up to $2. We charge $0.</sub>
</p>

<p align="center">
  <a href="https://interaone.app">Website</a> ·
  <a href="https://doc.interaone.app">Docs</a> ·
  <a href="https://discord.gg/interaone">Discord</a> ·
  <a href="https://github.com/InteraOne/InteraOne/issues">Report Bug</a> ·
  <a href="https://github.com/InteraOne/InteraOne/issues">Request Feature</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/stars/InteraOne/InteraOne?style=social" alt="GitHub Stars">
  <img src="https://img.shields.io/github/forks/InteraOne/InteraOne?style=social" alt="GitHub Forks">
  <img src="https://img.shields.io/github/license/InteraOne/InteraOne" alt="License">
  <img src="https://img.shields.io/badge/latency-500ms-brightgreen" alt="500ms latency">
  <img src="https://img.shields.io/badge/self--hosted-one%20click-blue" alt="Self Hosted">
</p>

<br/>

<p align="center">
  <img width="1536" height="1024" alt="InteraOne Dashboard" src="https://github.com/user-attachments/assets/23fd71c1-d913-46f3-87df-8f545c24b1d4" />
</p>

<hr/>

## Why InteraOne?

| | **InteraOne** | **Intercom (Fin)** | **Zendesk** | **Chatwoot** |
|---|---|---|---|---|
| **Base price** | Free & open source | $29–$132/agent/mo | $55–$169/agent/mo | $0–$99/agent/mo |
| **AI resolution cost** | $0 — unlimited | $0.99 / resolution | $1.50–$2.00 / resolution | AI credits capped, $20/1k overage |
| **Self-hosted** | ✅ One click | ❌ | ❌ | ✅ (no AI on free tier) |
| **Single AI Brain** | ✅ | ❌ | ❌ | ❌ |
| **WhatsApp + Email + Telegram + Widget** | ✅ | Partial | Partial | ✅ |
| **Agent Latency** | ⚡ ~500ms | Varies | Varies | No native AI on free tier |
| **Multiple LLM Providers** | ✅ | ❌ | ❌ | ❌ |
| **RAG Knowledge Base** | ✅ | Limited | Limited | ❌ |
| **Ticket + Inbox + Contacts AI** | ✅ | Partial | ✅ | ❌ |
| **QR Code Offline→Online** | ✅ | ❌ | ❌ | ❌ |

<sub>Pricing as of July 2026 — verify current rates before quoting.</sub>

<hr/>

<p align="center">
  <img width="1536" height="1024" alt="InteraOne architecture overview" src="https://github.com/user-attachments/assets/fd53d983-e9f6-4677-83f6-83df4a3b5f5f" />
</p>

## 🚀 Quick One-Click Dev Setup

### 1. Fork the repository

Fork this repository to your GitHub account.

### 2. Clone your fork

```bash
git clone https://github.com/<your-username>/InteraOne.git
cd InteraOne
```

### 4. Start the development environment

```bash
make all
```
> Gateway, console, agent, worker, and launcher all spin up together.
>> Update the `.env` files as needed for your local setup.

<hr/>

## 🧱 Architecture

| App | Role |
|---|---|
| `apps/gateway` | API gateway — routes and auth for all channels |
| `apps/console` | Admin dashboard for inbox, contacts, and settings |
| `apps/agent` | The AI brain — LLM orchestration across providers |
| `apps/worker` | Background jobs, queues, async processing |
| `apps/launcher` | Embeddable widget for websites and products |

### Optional Composio integrations

Workspace admins can connect allowlisted third-party tools through Composio. The feature is disabled by default and runs only in `apps/gateway`; no provider token or Composio API key is sent to the browser or stored in InteraOne.

1. Create a Composio project and enable its managed GitHub auth configuration.
2. Allow your console URL (for example `https://app.example.com/dashboard/integrations`) as the Connect Link redirect.
3. Set `COMPOSIO_ENABLED=true`, `COMPOSIO_API_KEY`, and `COMPOSIO_REDIRECT_URL` for the gateway. Set `COMPOSIO_ENVIRONMENT` to a stable deployment name so scoped user identities remain stable.
4. Restart the gateway, open **Integrations → AI tool connections**, and connect GitHub.

The initial policy enables only `GITHUB_SEARCH_REPOSITORIES`. An admin may opt into `GITHUB_CREATE_AN_ISSUE`; every use of that write action creates a short-lived, one-time approval. Public widget conversations do not receive Composio tools.

<hr/>

## ❤️ Contributors

The humans behind InteraOne 🚀

<a href="https://github.com/InteraOne/InteraOne/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=InteraOne/InteraOne" />
</a>

## 📄 License

Distributed under the license in [LICENSE](./LICENSE).

## 🌟 Star Us!

If you find InteraOne useful, please consider giving us a star on GitHub! It helps us grow and reach more contributors.
