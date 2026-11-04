"""data.gov.in download (app/core/mandi_sync.py), with a mock transport: no live requests."""
import httpx

from app.core import geo, mandi_sync


def test_fetch_sends_the_app_user_agent(monkeypatch):
    # data.gov.in's gateway answers default client names (python-httpx, python-requests) with a
    # 502 after about 60 s, so every request must name the app.
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("user-agent"))
        return httpx.Response(200, json={"status": "ok", "total": 1, "records": [{"state": "Tamil Nadu"}]})

    real_client = httpx.Client
    monkeypatch.setattr(mandi_sync.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(mandi_sync.settings, "DATA_GOV_API_KEY", "test-key")

    records, total = mandi_sync._fetch_all()

    assert (len(records), total) == (1, 1)
    assert seen == [geo.USER_AGENT]
