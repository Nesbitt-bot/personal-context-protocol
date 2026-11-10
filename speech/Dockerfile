FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 HF_HOME=/models HF_HUB_DISABLE_TELEMETRY=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
USER 1000:1000
EXPOSE 3102
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "3102"]
