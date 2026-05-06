FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY apps/txid/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/txid .
EXPOSE 7055

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7055"]