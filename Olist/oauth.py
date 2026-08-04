import webbrowser
import urllib.parse

from Olist.config import *

params = {
    "client_id": CLIENT_ID,
    "redirect_uri": REDIRECT_URI,
    "response_type": "code",
    "scope": "openid"
}

url = AUTH_URL + "?" + urllib.parse.urlencode(params)

webbrowser.open(url)