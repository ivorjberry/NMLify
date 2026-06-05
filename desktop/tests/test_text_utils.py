import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from text_utils import tokenize, STOP_WORDS, MIN_TOKEN_LEN


class TestTokenize:
    def test_lowercases(self):
        assert tokenize('HELLO World') == {'hello', 'world'}

    def test_drops_stop_words(self):
        # 'the' and 'remix' are stop words and should disappear
        tokens = tokenize('The Best Remix')
        assert 'the' not in tokens
        assert 'remix' not in tokens
        assert 'best' in tokens

    def test_drops_short_tokens(self):
        # Single-character tokens should be dropped (MIN_TOKEN_LEN >= 2)
        tokens = tokenize('a b cd')
        assert 'a' not in tokens
        assert 'b' not in tokens
        assert 'cd' in tokens

    def test_splits_on_punctuation(self):
        tokens = tokenize("Rock'n'Roll!! (Remix)")
        assert 'rock' in tokens
        assert 'roll' in tokens

    def test_empty_string(self):
        assert tokenize('') == set()

    def test_none(self):
        assert tokenize(None) == set()

    def test_constants_exposed(self):
        # Confirm the public surface used by indexers
        assert MIN_TOKEN_LEN >= 2
        assert 'the' in STOP_WORDS
