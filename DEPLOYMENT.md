# LLM Tool Proxy - Deployment Guide

## 🚀 Production Deployment

### Docker Compose (Recommended)

1. **Clone and configure:**
   ```bash
   git clone <repository>
   cd llm-tool-proxy
   cp .env.example .env
   # Edit .env with production settings
   ```

2. **Deploy:**
   ```bash
   docker compose up -d --build
   ```

3. **Verify:**
   ```bash
   curl http://localhost:11434/healthz
   ```

### Manual Deployment

1. **Prerequisites:**
   - Node.js 20+
   - Git
   - Upstream LLM service (Ollama, LM Studio, etc.)

2. **Build:**
   ```bash
   npm install
   npm run build
   ```

3. **Start:**
   ```bash
   npm start
   # Or use PM2 for production:
   pm2 start dist/server.js --name llm-tool-proxy
   ```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UPSTREAM_URL` | LLM API endpoint | `http://localhost:11434/v1/chat/completions` |
| `UPSTREAM_API_KEY` | API key for upstream | `your-api-key-here` |
| `DEFAULT_MODEL` | Default model name | `llama3.1:8b` |
| `WORKSPACE_ROOT` | Workspace directory | `/app/workspace` |
| `PORT` | Server port | `11434` |
| `EXEC_TIMEOUT_MS` | Command timeout | `8000` |
| `EXEC_MAX_BUFFER` | Output buffer limit | `1048576` |
| `EXEC_BLOCKLIST` | Blocked commands regex | See .env.example |

### Security Settings

- **Workspace Isolation**: All operations restricted to `WORKSPACE_ROOT`
- **Command Filtering**: Dangerous commands blocked via regex
- **Resource Limits**: Timeouts and buffer limits prevent abuse
- **Non-Root Execution**: Container runs as unprivileged user

## 🔍 Monitoring

### Health Check
```bash
curl http://localhost:11434/healthz
# Expected: {"ok":true}
```

### Logs
```bash
# Docker Compose
docker compose logs -f

# Manual deployment
tail -f logs/app.log
```

### Metrics
- Response time monitoring via logs
- Tool execution success/failure rates
- Resource usage (CPU, memory, disk)

## 🛡️ Security Considerations

1. **Network Security:**
   - Run behind reverse proxy (nginx, traefik)
   - Use HTTPS in production
   - Restrict access to trusted networks

2. **Container Security:**
   - Regular base image updates
   - Scan for vulnerabilities
   - Limit container resources

3. **Workspace Security:**
   - Mount workspace as read-only if possible
   - Regular backup of workspace data
   - Monitor file system usage

## 🔄 Updates

1. **Pull latest changes:**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart:**
   ```bash
   docker compose down
   docker compose up -d --build
   ```

3. **Verify deployment:**
   ```bash
   curl http://localhost:11434/healthz
   ```

## 🆘 Troubleshooting

### Common Issues

1. **Port conflicts:**
   - Change `PORT` in .env
   - Check for other services on port 11434

2. **Upstream connection:**
   - Verify `UPSTREAM_URL` is accessible
   - Check API key validity
   - Test with curl

3. **Permission errors:**
   - Check workspace directory permissions
   - Verify container user has access

4. **Tool execution failures:**
   - Check command blocklist
   - Verify workspace paths
   - Review timeout settings

### Debug Mode

Enable verbose logging:
```bash
export DEBUG=llm-tool-proxy:*
npm start
```

## 📊 Performance Tuning

1. **Resource Limits:**
   ```yaml
   # docker-compose.yml
   services:
     llm-tool-proxy:
       deploy:
         resources:
           limits:
             memory: 512M
             cpus: '0.5'
   ```

2. **Timeout Optimization:**
   - Adjust `EXEC_TIMEOUT_MS` based on workload
   - Monitor command execution times
   - Set appropriate buffer limits

3. **Caching:**
   - Consider caching tool results
   - Use persistent workspace volumes
   - Optimize Docker layer caching