# GradeFlip Research connection

MCP URL: https://pokemon-grade-flips-production.up.railway.app/mcp

Connect as a custom MCP server in ChatGPT Plugins; select OAuth and dynamic registration. The server publishes authorization metadata, uses S256 PKCE, requires the private connection password and issues a 30-day token. Reconnect when it expires. The connection password is configured as GRADEFLIP_PLUGIN_PASSWORD in Railway, never in the source repository. Do not make this plugin public without redesigning its single-owner authentication.

Tools: research_strategy, save_research_batch, list_researched_cards, get_researched_card. Save at most five cards per batch, each with exact identity, version, population provenance, individual completed-sale records and notes. Missing numbers must be null, not zero. Batch IDs are idempotent and cannot be reused with different data. Older research does not overwrite newer research. Records live in separate PostgreSQL tables; existing Pokemon and sports price tables are not modified by plugin writes.

Dashboard: /research, sign in at /plugin/login. Player, raw price and evidence filters are available. Averages use at most five submitted records within 180 days per platform/grade. CGC10 without confirmed Gem Mint label is excluded. Population ratio is conditional historical evidence, not raw grading odds. Candidate classification requires combined PSA9/10 >=50, more10s than9s and positive CGC10 illustration after $11 grading and an assumed 15% selling fee. Partial evidence retains cards without complete CGC evidence. Adjust fees in the dashboard illustrations. Always manually inspect and verify.

This plugin stores and queries evidence. It does not fetch SportsCardsPro, bypass blocks, supply built-in web search, guarantee market-wide latest-five comps, or run unattended overnight research. ChatGPT must research with tools available in the conversation, then save evidence. Give concise summaries with dashboard links rather than dumping all records in chat.

Run: npm install; node --test research-plugin.test.js. MCP and OAuth end-to-end tests are also required against the deployed service before declaring the connection working.
