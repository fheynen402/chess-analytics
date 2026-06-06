from fastapi import FastAPI

app = FastAPI(title="Chess Analytics API")

@app.get("/health")
def health():
    return {"status": "ok"}
