
## claude code with Ollama
```shell
export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_BASE_URL=http://localhost:11434
claude --model ollama/glm-4.7-flash
```

### Claude with Beast
```shell
export ANTHROPIC_AUTH_TOKEN=ollama
export ANTHROPIC_BASE_URL=http://beast:11434
claude --model ollama/glm-4.7-flash
```


# Claude code with Deepseek

```shell
export ANTHROPIC_AUTH_TOKEN=sk-f3cd0725cd33443982f45b02a94a93cb
export API_TIMEOUT_MS=600000
export ANTHROPIC_MODEL=deepseek-chat
export ANTHROPIC_SMALL_FAST_MODEL=deepseek-chat
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```