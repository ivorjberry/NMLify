import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from collection_utils import load_collection, verify_collection_file, clean_location


TESTFILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'testfiles', 'collection.nml')


class TestLoadCollection:
    def test_loads_entries(self):
        entries = load_collection(TESTFILE)
        assert isinstance(entries, list)
        assert len(entries) > 0

    def test_entries_have_required_fields(self):
        entries = load_collection(TESTFILE)
        first = entries[0]
        assert '@TITLE' in first
        assert '@ARTIST' in first or '@TITLE' in first  # artist can be missing
        assert 'LOCATION' in first


class TestVerifyCollectionFile:
    def test_valid_nml(self):
        result = verify_collection_file('collection.nml')
        assert 'Success' in result

    def test_invalid_extension(self):
        result = verify_collection_file('collection.xml')
        assert 'Error' in result

    def test_empty(self):
        result = verify_collection_file('')
        assert 'Error' in result

    def test_none(self):
        result = verify_collection_file(None)
        assert 'Error' in result


class TestCleanLocation:
    def test_strips_whitespace(self):
        assert clean_location('  /path/to/file  ') == '\\path\\to\\file'

    def test_replaces_slashes(self):
        assert clean_location('/path/to/file') == '\\path\\to\\file'

    def test_removes_colons(self):
        assert clean_location('/:Music/:folder/:') == '\\Music\\folder\\'
